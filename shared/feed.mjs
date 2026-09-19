// Flux temps réel depuis le WebSocket du RPC (navigateur ou Node ≥ 22 : WebSocket global).
//
// Sur Monad on utilise monadLogs / monadNewHeads : mêmes données que logs / newHeads, mais
// publiées dès l'état Proposed et RE-publiées à chaque changement d'état du bloc
// (Proposed → Voted → Finalized → Verified). Conséquences, mesurées sur le testnet :
//   - chaque log arrive ~3 fois → on dédoublonne sur (blockId, logIndex) ;
//   - un bloc Proposed peut être abandonné sans prévenir → la clé est blockId, pas le numéro.
import { decodeEventLog } from 'viem'
import { ABI } from './config.mjs'

const STATE_RANK = { Proposed: 0, Voted: 1, Finalized: 2, Verified: 3 }

/**
 * @param {object} o
 * @param {string} o.wsUrl
 * @param {string} o.address adresse du contrat AuraFarm
 * @param {boolean} o.monad true = monadLogs/monadNewHeads, false = logs/newHeads (anvil)
 * @param {(ev: {name:string, args:any, log:any, state:string, first:boolean}) => void} o.onEvent
 *        appelé à CHAQUE changement d'état ; `first` = première fois qu'on voit ce log
 * @param {(head: {number:number, blockId:string, state:string, baseFee:bigint, timestamp:number}) => void} [o.onHead]
 * @param {(status: 'open'|'closed') => void} [o.onStatus]
 */
export function openFeed({ wsUrl, address, monad, onEvent, onHead, onStatus }) {
  let ws
  let closed = false
  let retry = 0
  const seen = new Map() // `${blockId}:${logIndex}` → meilleur rang d'état vu
  const subs = {} // id de souscription → 'logs' | 'heads'

  const connect = () => {
    ws = new WebSocket(wsUrl)
    ws.onopen = () => {
      retry = 0
      onStatus?.('open')
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: [monad ? 'monadLogs' : 'logs', { address }] }))
      if (onHead) ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_subscribe', params: [monad ? 'monadNewHeads' : 'newHeads'] }))
    }
    ws.onmessage = (msg) => {
      const m = JSON.parse(msg.data)
      if (m.id === 1) return void (subs[m.result] = 'logs')
      if (m.id === 2) return void (subs[m.result] = 'heads')
      const r = m.params?.result
      if (!r) return
      if (subs[m.params.subscription] === 'heads') return handleHead(r)
      handleLog(r)
    }
    ws.onclose = () => {
      onStatus?.('closed')
      if (!closed) setTimeout(connect, Math.min(5000, 300 * 2 ** retry++))
    }
    // Ne pas appeler ws.close() ici : sous Node/undici, close() re-déclenche onerror
    // et fait exploser la pile (Maximum call stack size exceeded).
    ws.onerror = () => {}
  }

  const handleHead = (h) =>
    onHead({
      number: Number(h.number),
      blockId: h.blockId ?? h.hash,
      state: h.commitState ?? 'Finalized',
      baseFee: BigInt(h.baseFeePerGas ?? 0),
      timestamp: Number(h.timestamp),
    })

  const handleLog = (log) => {
    const state = log.commitState ?? 'Finalized'
    const key = `${log.blockId ?? log.blockHash}:${log.logIndex}`
    const rank = STATE_RANK[state] ?? 2
    const prev = seen.get(key)
    if (prev !== undefined && prev >= rank) return // doublon ou état plus ancien
    seen.set(key, rank)
    if (seen.size > 20000) for (const k of [...seen.keys()].slice(0, 10000)) seen.delete(k)
    let decoded
    try {
      decoded = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics })
    } catch {
      return
    }
    onEvent({ name: decoded.eventName, args: decoded.args, log, state, first: prev === undefined })
  }

  connect()
  return {
    close() {
      closed = true
      ws?.close()
    },
  }
}
