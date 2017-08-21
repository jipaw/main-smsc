const knex = require('../../config/knex')
const _ = require('lodash')
let hlrCount = require('../../config/app_var').hlrCount

const objHLR = [
  { op: 'TSEL', min: 10, max: 12, regex: '^08(11|12|13|21|22|23|51|52|53|54)' },
  { op: 'ISAT', min: 10, max: 12, regex: '^08(14|15|16|55|56|57|58)' },
  { op: 'XL', min: 10, max: 12, regex: '^08(17|18|19|59|77|78|31|32|33|38)' },
  { op: 'THREE', min: 10, max: 13, regex: '^08(95|96|97|98|99)' },
  { op: 'SMART', min: 10, max: 12, regex: '^08(81|82|83|84|85|86|87|88|89)' },
  { op: 'CERIA', min: 10, max: 12, regex: '^08(28|29)' }
]
const blacklist = ['08888888888', '0888888888888']

module.exports.decrementToken = function decrementToken (msidn) {
  knex('sender').where({
    msidn: msidn
  }).update({
    token: knex.raw('token - 1')
  }).then((result) => {
    return result
  }).catch((e) => console.error(e))
}

module.exports.incrementToken = function incrementToken (msidn) {
  knex('sender').where({
    msidn: msidn
  }).update({
    token: knex.raw('token + 1')
  }).then((result) => {
    return result
  }).catch((e) => console.error(e))
}

module.exports.getSender = function getSender (hlr, callback) {
  knex('sender').select('id', 'msidn', 'prefix', 'token', 'delay', 'active').where('status', 'online').asCallback((e, result) => {
    if (e) return console.error(e)
    if (hlr === 'NO-HLR') { return callback(_.sample(result)) }
    let device = []
    for (let i = 0; i < result.length; i++) {
      const {id, msidn, prefix, token, delay} = result[i]
      let temp = JSON.parse(prefix)
      let obj = {
        id: id,
        msidn: msidn,
        prefix: JSON.parse(prefix),
        token: token,
        delay: delay
      }
      temp.forEach((item, index) => {
        let data = _.some(temp, (item) => {
          return item.toString() === hlr.toString()
        })
        if (data) { device.push(obj) }
      })
    }
    // if (!device) { return }
    const devices = _.sortBy(_.uniq(device), 'id')
    // console.log(devices)
    hlrCount[_.findIndex(hlrCount, {'hlr': hlr})].count++
    let count = hlrCount[_.findIndex(hlrCount, {'hlr': hlr})].count
    let sender = []
    if (count === devices.length) {
      count = 0
      hlrCount[_.findIndex(hlrCount, {'hlr': hlr})].count = 0
    }
    sender = devices[0 + count]
    if (sender === undefined) { return }
    console.log(sender.id, '|', sender.msidn, '|', devices.length, '|', count)
    return callback(sender)
  })
}

module.exports.getRandSender = function getRandSender (hlr, callback) {
  knex('sender').select('id', 'msidn', 'prefix', 'token', 'delay', 'active').where('status', 'online').asCallback((e, result) => {
    if (e) return console.error(e)
    if (hlr === 'NO-HLR') { return callback(_.sample(result)) }
    let device = []
    for (let i = 0; i < result.length; i++) {
      const {id, msidn, prefix, token, delay} = result[i]
      let temp = JSON.parse(prefix)
      let obj = {
        id: id,
        msidn: msidn,
        prefix: JSON.parse(prefix),
        token: token,
        delay: delay
      }
      temp.forEach((item, index) => {
        let data = _.some(temp, (item) => {
          return item.toString() === hlr.toString()
        })
        if (data) { device.push(obj) }
      })
    }
    const devices = _.sortBy(_.uniq(device), 'id')
    return callback(_.sample(devices))
  })
}

module.exports.formatNumber = function formatNumber (destination) {
  let prefix = new RegExp(/^((?:\+62|62))/)
  if (destination.match(new RegExp(prefix))) {
    destination = destination.replace(prefix, '0')
    return destination
  }
  return destination
}

module.exports.filterBadNumber = function filterBadNumber (destination, hlr) {
  if (hlr === 'NO-HLR') { return true }
  if (_.some(blacklist, (str) => {
    return _.includes(str, destination)
  }) === true) { return true }
  const filterHlr = _.filter(objHLR, {'op': hlr})
  if (destination.length < filterHlr[0].min || destination.length > filterHlr[0].max) {
    return true
  } else {
    return false
  }
}
module.exports.getHlr = function getHlr (destination) {
  let prefix = new RegExp(/^((?:\+62|62))/)
  let hlr = 'NO-HLR'
  if (destination.match(new RegExp(prefix))) {
    destination = destination.replace(prefix, '0')
  }

  for (let i = 0; i < objHLR.length; i++) {
    let data = destination.match(new RegExp(objHLR[i].regex.toString()))
    if (data !== null) {
      hlr = objHLR[i].op
      return hlr
    }
  }
  return hlr
}

module.exports.replaceChar = function replaceChar (message, pattern, replacement) {
//  const a = '\u00e0'
//  const i = '\u00ec'
//  const u = '\u00f9'
//  const e = '\u00e8'
//  const o = '\u00f2'
  let sentence = message
  if (sentence.indexOf(pattern) !== -1) {
    return sentence.replace(pattern, replacement)
  } else return sentence
}

module.exports.replaceWord = function replaceWord (message, word, replacement) {
  let sentence = message
  if (sentence.indexOf(word) !== -1) {
    return sentence.replace(word, replacement)
  } else return sentence
}
