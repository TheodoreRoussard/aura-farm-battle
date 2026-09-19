// TxPump : envoie des transactions à la chaîne depuis UNE clé, plusieurs fois par seconde.
// Fonctionne à l'identique dans le navigateur (téléphone) et dans Node (test de charge).
//
// Pourquoi ne pas utiliser walletClient.writeContract ? Par défaut viem fait 3-4 appels RPC
// par transaction (nonce, estimation du gas, frais). Ici : zéro appel avant l'envoi.
//  - nonce : compteur local (chaque tx d'un compte porte un numéro d'ordre sans trou) ;
//  - gas   : limite en dur (sur Monad on paie la limite, pas le gas consommé) ;
//  - frais : base fee mise en cache, rafraîchie toutes les ~10 s.
//
// Le piège propre à Monad : il n'y a pas de mempool global. Si une tx se perd en route,
// elle laisse un trou dans les nonces et TOUTES les suivantes restent bloquées.
// → un "chien de garde" compare chaque seconde le nonce local à celui de la chaîne
//   et renvoie les transactions manquantes.
import { keccak256 } from 'viem'
import { FEES } from './config.mjs'

const STUCK_MS = 1500 // ~5 blocs sans inclusion = suspect
const MAX_TRIES = 4
const WATCHDOG_MS = 1000

export class TxPump {
  /**
   * @param {object} o
   * @param {import('viem').LocalAccount} o.account compte local (clé privée en mémoire)
   * @param {number} o.chainId
   * @param {string[]} o.rpcUrls endpoints HTTP, par ordre de préférence
   * @param {(items: {meta:any, reason:string}[]) => void} [o.onDropped] tx abandonnées
   */
  constructor({ account, chainId, rpcUrls, onDropped }) {
    this.account = account
    this.chainId = chainId
    this.rpcUrls = rpcUrls
    this.rpcIndex = 0
    this.onDropped = onDropped ?? (() => {})
    this.nextNonce = null
    this.baseFee = 100_000_000_000n // plancher Monad : 100 gwei
    this.inflight = new Map() // nonce → { raw, hash, sentAt, tries, meta }
    this.byHash = new Map() // hash → sentAt (pour mesurer la latence à l'arrivée du log)
    this.stats = { signed: 0, landed: 0, resent: 0, dropped: 0, rpcErrors: {}, rpcCalls: 0 }
    this._timer = null
    this._ticks = 0
    this._reserved = 0 // nonces réservés dont la signature est en cours
    this._lastSync = 0
    this._syncing = null
    this._rpcId = 0
  }

  async init() {
    await Promise.all([this._syncNonce(), this._refreshBaseFee()])
    this._timer = setInterval(() => this._watchdog().catch(() => {}), WATCHDOG_MS)
    return this
  }

  stop() {
    clearInterval(this._timer)
  }

  get pending() {
    return this.inflight.size
  }

  /** Signe et envoie sans attendre le reçu. Retourne le hash, connu dès la signature. */
  async send({ to, data = '0x', gas, value = 0n, meta }) {
    if (this.nextNonce === null) throw new Error('TxPump.init() non appelé')
    // File vide depuis un moment (ex. clé admin partagée avec un script) : on se recale sur la chaîne.
    if (this._idle() && Date.now() - this._lastSync > 3000) {
      await (this._syncing ??= this._syncNonce().finally(() => (this._syncing = null)))
    }
    const nonce = this.nextNonce++ // réservé de façon synchrone : deux taps simultanés ≠ même nonce
    this._reserved++
    let raw
    try {
      raw = await this._sign(nonce, { to, data, value, gas })
    } finally {
      this._reserved--
    }
    const hash = keccak256(raw)
    const entry = { raw, hash, sentAt: Date.now(), tries: 1, meta }
    this.inflight.set(nonce, entry)
    this.byHash.set(hash, entry.sentAt)
    this.stats.signed++
    this._rpc('eth_sendRawTransaction', [raw]).catch((e) => this._noteError(e))
    return hash
  }

  _idle() {
    return this.inflight.size === 0 && this._reserved === 0
  }

  _sign(nonce, { to, data, value, gas }) {
    return this.account.signTransaction({
      type: 'eip1559',
      chainId: this.chainId,
      nonce,
      to,
      data,
      value,
      gas,
      maxPriorityFeePerGas: FEES.maxPriorityFeePerGas,
      maxFeePerGas: this._maxFee(),
    })
  }

  /** À appeler quand un log de cette tx arrive : renvoie la latence envoi → vue (ms). */
  seen(hash) {
    const t = this.byHash.get(hash)
    if (t === undefined) return null
    this.byHash.delete(hash)
    return Date.now() - t
  }

  async balance() {
    return BigInt(await this._rpc('eth_getBalance', [this.account.address, 'latest']))
  }

  /** Attend que toutes les tx en vol soient incluses. Renvoie false si l'une d'elles a été abandonnée
   *  par le chien de garde pendant l'attente (file vide ≠ tout est passé) ou si le délai est dépassé. */
  async drain(timeoutMs = 15000) {
    const t0 = Date.now()
    const dropped = this.stats.dropped
    while (this.inflight.size > 0 && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 200))
    return this.inflight.size === 0 && this.stats.dropped === dropped
  }

  // ───────────────────────────────── interne ─────────────────────────────────

  _maxFee() {
    return (this.baseFee * BigInt(Math.round(FEES.maxFeeMultiplier * 100))) / 100n + FEES.maxPriorityFeePerGas
  }

  async _syncNonce() {
    const n = Number(BigInt(await this._rpc('eth_getTransactionCount', [this.account.address, 'latest'])))
    if (this.nextNonce === null || this._idle()) this.nextNonce = n
    this._lastSync = Date.now()
    return n
  }

  async _refreshBaseFee() {
    const block = await this._rpc('eth_getBlockByNumber', ['latest', false])
    if (block?.baseFeePerGas) this.baseFee = BigInt(block.baseFeePerGas)
  }

  async _watchdog() {
    if (++this._ticks % 10 === 0) this._refreshBaseFee().catch(() => {})
    if (this.inflight.size === 0) return
    const chainNonce = await this._syncNonce()
    const now = Date.now()

    // 1) tout ce qui est sous le nonce de la chaîne est inclus (réussi ou revert, peu importe ici)
    for (const nonce of [...this.inflight.keys()]) {
      if (nonce < chainNonce) {
        this.inflight.delete(nonce)
        this.stats.landed++
      }
    }

    // 2) la tx attendue par la chaîne traîne : on la renvoie, ainsi que ses suivantes
    const head = this.inflight.get(chainNonce)
    if (!head || now - head.sentAt < STUCK_MS) return
    if (head.tries >= MAX_TRIES) return this._dropFrom(chainNonce, 'bloquée après plusieurs renvois')
    const stuck = [...this.inflight.entries()]
      .filter(([, e]) => now - e.sentAt >= STUCK_MS)
      .sort(([a], [b]) => a - b)
      .slice(0, 10)
    for (const [, e] of stuck) {
      e.tries++
      e.sentAt = now
      this.stats.resent++
      this._rpc('eth_sendRawTransaction', [e.raw]).catch((err) => this._noteError(err))
    }
  }

  /** Abandonne la file à partir d'un nonce et repart proprement du nonce de la chaîne. */
  _dropFrom(nonce, reason) {
    const dropped = []
    for (const [n, e] of [...this.inflight.entries()]) {
      if (n >= nonce) {
        this.inflight.delete(n)
        this.byHash.delete(e.hash)
        dropped.push({ meta: e.meta, reason })
      }
    }
    this.stats.dropped += dropped.length
    this.nextNonce = nonce
    if (dropped.length) this.onDropped(dropped)
  }

  _noteError(e) {
    const msg = String(e?.message ?? e).slice(0, 80)
    if (/already known|already exists/i.test(msg)) return // renvoi d'une tx déjà connue : normal
    this.stats.rpcErrors[msg] = (this.stats.rpcErrors[msg] ?? 0) + 1
  }

  async _rpc(method, params) {
    let lastErr
    for (let attempt = 0; attempt < this.rpcUrls.length; attempt++) {
      const url = this.rpcUrls[this.rpcIndex % this.rpcUrls.length]
      try {
        this.stats.rpcCalls++
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++this._rpcId, method, params }),
        })
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (json.error) {
          const err = new Error(json.error.message ?? 'erreur RPC')
          err.rpc = true // erreur "métier" (nonce, solde...) : inutile d'essayer un autre endpoint
          throw err
        }
        return json.result
      } catch (e) {
        lastErr = e
        if (e.rpc) break
        this.rpcIndex++ // limite de débit ou réseau : on bascule sur l'endpoint suivant
      }
    }
    throw lastErr
  }
}
