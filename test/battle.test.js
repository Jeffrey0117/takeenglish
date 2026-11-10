const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createBattles } = require('../src/battle')

const A = { owner: 'te-a', name: 'Amy' }
const B = { owner: 'te-b', name: 'Ben' }
const C = { owner: 'te-c', name: 'Cat' }

function room(options = {}) {
  const battles = createBattles({ maxPlayers: 3, ...options })
  const made = battles.create({ songId: 'demo', total: 4, ...A })
  return { battles, code: made.code, host: made.playerId, made }
}

test('開房:六碼房號、開房的人是房主、停在第 0 句還沒開始', () => {
  const { battles, code, host, made } = room()
  assert.match(code, /^[A-Z0-9]{6}$/)
  const state = battles.state(code)
  assert.equal(state.line, 0)
  assert.equal(state.started, false)
  assert.equal(state.over, false)
  assert.equal(state.players.length, 1)
  assert.equal(state.players[0].id, host)
  assert.equal(state.players[0].host, true)
  assert.ok(made.playerToken)
})

test('房號不存在就說不存在', () => {
  const { battles } = room()
  assert.equal(battles.join('ZZZZZZ', B).error, 'room_not_found')
  assert.equal(battles.state('ZZZZZZ'), null)
})

test('加入:名字進名單,房主不變', () => {
  const { battles, code, host } = room()
  const joined = battles.join(code, B)
  assert.equal(joined.error, undefined)
  const state = battles.state(code)
  assert.deepEqual(state.players.map((p) => p.name), ['Amy', 'Ben'])
  assert.equal(state.players.find((p) => p.host).id, host)
})

test('同一個人重新連線拿回原本的位置,不會變成兩個玩家', () => {
  const { battles, code } = room()
  const first = battles.join(code, B)
  const again = battles.join(code, B)
  assert.equal(again.playerId, first.playerId)
  assert.equal(battles.state(code).players.length, 2)
})

test('房間滿了就不給進', () => {
  const { battles, code } = room()
  battles.join(code, B)
  battles.join(code, C)
  assert.equal(battles.join(code, { owner: 'te-d', name: 'Dan' }).error, 'room_full')
})

test('開始:只有房主能開,而且至少要兩個人', () => {
  const { battles, code, host } = room()
  assert.equal(battles.start(code, host).error, 'need_players')
  const ben = battles.join(code, B).playerId
  assert.equal(battles.start(code, ben).error, 'not_host')
  assert.equal(battles.start(code, host).error, undefined)
  assert.equal(battles.state(code).started, true)
})

test('還沒開始的回報不算分', () => {
  const { battles, code, host } = room()
  battles.join(code, B)
  const res = battles.cleared(code, host, 0)
  assert.equal(res.error, 'not_started')
  assert.equal(battles.state(code).players[0].points, 0)
})

test('先打完那句的人得 1 分,而且全場一起被推到下一句', () => {
  const { battles, code, host } = room()
  const ben = battles.join(code, B).playerId
  battles.start(code, host)
  const first = battles.cleared(code, ben, 0)
  assert.equal(first.advanced, true)
  assert.equal(first.point, true)
  const state = battles.state(code)
  assert.equal(state.line, 1)
  assert.equal(state.players.find((p) => p.id === ben).points, 1)
  assert.equal(state.players.find((p) => p.id === host).points, 0)
})

test('慢的人回報已經過去的那一句:不得分、也不會把全場往回拉', () => {
  const { battles, code, host } = room()
  const ben = battles.join(code, B).playerId
  battles.start(code, host)
  battles.cleared(code, ben, 0)
  const late = battles.cleared(code, host, 0)
  assert.equal(late.point, false)
  assert.equal(late.advanced, false)
  assert.equal(battles.state(code).line, 1)
  assert.equal(battles.state(code).players.find((p) => p.id === host).points, 0)
})

test('同一個人對同一句回報兩次不會拿兩分', () => {
  const { battles, code, host } = room()
  const ben = battles.join(code, B).playerId
  battles.start(code, host)
  battles.cleared(code, ben, 0)
  battles.cleared(code, ben, 1)
  battles.cleared(code, ben, 1)
  assert.equal(battles.state(code).players.find((p) => p.id === ben).points, 2)
  assert.equal(battles.state(code).line, 2)
})

test('最後一句打完就結束,名次照分數排', () => {
  const { battles, code, host } = room()
  const ben = battles.join(code, B).playerId
  battles.start(code, host)
  battles.cleared(code, ben, 0)
  battles.cleared(code, ben, 1)
  battles.cleared(code, host, 2)
  const last = battles.cleared(code, ben, 3)
  assert.equal(last.state.over, true)
  assert.deepEqual(last.state.players.map((p) => [p.name, p.points]), [['Ben', 3], ['Amy', 1]])
})

test('房號可以換成玩家(SSE 要用它訂閱,所以它只在這一間房有用)', () => {
  const { battles, code, made } = room()
  const other = createBattles({})
  assert.equal(battles.byToken(code, made.playerToken), made.playerId)
  assert.equal(battles.byToken(code, 'nope'), null)
  assert.equal(other.byToken(code, made.playerToken), null)
})

test('離開:走了就不在名單上;房主走了換下一個人當房主', () => {
  const { battles, code, host } = room()
  const ben = battles.join(code, B).playerId
  battles.leave(code, host)
  const state = battles.state(code)
  assert.deepEqual(state.players.map((p) => p.id), [ben])
  assert.equal(state.players[0].host, true)
})

test('人都走了房間就收掉', () => {
  const { battles, code, host } = room()
  battles.leave(code, host)
  assert.equal(battles.state(code), null)
})

test('沒人動的房間會被清掉', () => {
  const clock = { at: Date.now() }
  const { battles, code } = room({ now: () => clock.at, idleMs: 1000 })
  clock.at += 2000
  battles.sweep()
  assert.equal(battles.state(code), null)
})

test('房間數有上限:滿了而且都還活著就不給開新的', () => {
  const battles = createBattles({ maxRooms: 2 })
  battles.create({ songId: 'demo', total: 4, ...A })
  battles.create({ songId: 'demo', total: 4, ...B })
  assert.equal(battles.create({ songId: 'demo', total: 4, ...C }).error, 'too_many_rooms')
})

test('狀態不帶 owner(那是 te-<sub>,不能出現在別人看得到的地方)', () => {
  const { battles, code } = room()
  battles.join(code, B)
  assert.equal(JSON.stringify(battles.state(code)).includes('te-'), false)
})

test('訂閱:房間一有變化就收到新的狀態', () => {
  const { battles, code, host } = room()
  const seen = []
  const stop = battles.subscribe(code, (state) => seen.push(state.players.length))
  battles.join(code, B)
  battles.start(code, host)
  stop()
  battles.leave(code, host)
  assert.deepEqual(seen, [2, 2])
})

test('POST 進來只知道 owner,要能換成房內的玩家', () => {
  const { battles, code, host } = room()
  battles.join(code, B)
  assert.equal(battles.whoIs(code, A.owner), host)
  assert.equal(battles.whoIs(code, 'te-nobody'), null)
  assert.equal(battles.whoIs('ZZZZZZ', A.owner), null)
})
