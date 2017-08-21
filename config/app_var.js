let autoResend = true
let autoProcess = true
let maintenanceMode = false
let passthroughMode = false
let heartbeatProcess = 4
let heartbeatResend = 6
let limitProcess = 3
let maxResend = 2
let charReplace = 0
let wordReplace = 0
let char = ''
let word = ''
let pattern = ''
let hlrCount = [
  { hlr: 'TSEL', count: 0 },
  { hlr: 'ISAT', count: 0 },
  { hlr: 'XL', count: 0 },
  { hlr: 'THREE', count: 0 },
  { hlr: 'SMART', count: 0 },
  { hlr: 'CERIA', count: 0 },
  { hlr: 'NO-HLR', count: 0 }
]

module.exports = {
  autoResend: autoResend,
  autoProcess: autoProcess,
  maintenanceMode: maintenanceMode,
  passthroughMode: passthroughMode,
  heartbeatProcess: heartbeatProcess,
  heartbeatResend: heartbeatResend,
  limitProcess: limitProcess,
  maxResend: maxResend,
  charReplace: charReplace,
  wordReplace: wordReplace,
  char: char,
  word: word,
  hlrCount: hlrCount,
  pattern: pattern
}
