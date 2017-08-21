const knex = require('../../../config/knex')
const moment = require('moment')
const kue = require('kue')
const jobs = kue.createQueue()
const cron = require('cron')
const md5 = require('md5')
const _ = require('lodash')
const uuidV4 = require('uuid/v4')
const Boom = require('boom')
const Joi = require('joi')
const Wreck = require('wreck')
const password = require('../../lib/password')
const Schema = require('../../lib/schema')
const smsHelper = require('../../helper/sms-helper')
const appVar = require('../../../config/app_var')

// TODO: set limit pending for request
// let limitPending = 1000
/* in_stat
 * 0: queue in
 * 2: process
 * 4: sent
 * 5: resend in
 * 6: resend
 * 7: failed
 */

exports.register = (server, options, next) => {
  const io = server.plugins['hapi-io'].io

  io.on('connection', function (socket) {
    console.log('Server connected to ' + Object.keys(io.sockets.connected).length + ' SMSC Client')
    Object.keys(io.sockets.sockets).forEach((id) => {
      console.log('ID:', id)  // socketId
    })
    socket.on('offline_device', (data) => {
      console.log(data)
      for (let i = 0; i < data.length; i++) {
        knex('sender').where('msidn', data.msidn).returning('id').update({
          status: 'offline'
        }).catch((e) => console.error(e))
      }
    })
    socket.on('active_device', (data) => {
      // console.log(data)
      knex('sender').returning('id').update({
        status: 'offline'
      }).then((result) => {
        for (let i = 0; i < data.length; i++) {
          const { id, port, msidn } = data[i]
          const prefix = ['TSEL', 'XL', 'ISAT', 'THREE', 'SMART']
          knex.raw('SELECT EXISTS(SELECT 1 FROM sender WHERE id = ?) AS mycheck', [id]).then(([result]) => {
            // console.log(result[0].mycheck)
            if (result[0].mycheck === 1) {
              knex('sender').where('id', id).returning('id').update({
                id: id,
                port: port,
                msidn: msidn,
                status: 'online'
              }).then((result) => {
                // console.log(result)
                return result
              }).catch((err) => {
                console.error(err)
              })
            } else {
              knex('sender').where('id', id).returning('id').insert({
                id: id,
                port: port,
                msidn: msidn,
                prefix: JSON.stringify(prefix),
                token: 1000,
                delay: 5,
                status: 'online'
              }).then((result) => {
                // console.log(result)
                return result
              }).catch((err) => {
                console.error(err)
              })
            }
          })
        }
        return result
      }).catch((err) => {
        console.error(err)
      })
    })
    socket.on('ussd_data', (data) => {
      console.log('[LOG USSD]', data)
      knex('ussd_in').insert({
        msidn: data.msidn,
        in_time: moment().format('YYYY-MM-DD HH:mm:ss'),
        ussd: data.ussd,
        message: data.message,
        hlr: smsHelper.getHlr(data.msidn)
      }).asCallback((e, result) => {
        if (e) return console.log('[LOG ERROR] Error save log_message', e)
        return result
      })
      // knex('log_provider').insert({
      //   log_time: now,
      //   log_message: data
      // }).asCallback((e, result) => {
      //   if (e) return console.log('[LOG ERROR] Error save log_message', e)
      //   return result
      // })
    })
    socket.on('send_data', function (data) {
      const now = moment().format('YYYY-MM-DD HH:mm:ss')
      console.log('[LOG PROVIDER]', now, '|', data.user.toUpperCase(), '|', data.counter, '|', data.flag.toUpperCase(), data.reference, '| Message to', data.destination, '| by', data.smsc, data.chip_sender)
      const { counter, flag, destination, trxid, reference, chip_sender } = data
      const message = JSON.stringify(data)
      knex('log_provider').insert({
        log_time: now,
        log_message: message
      }).asCallback((e, result) => {
        if (e) return console.log('[LOG ERROR] Error save log_message', e)
        return result
      })
      knex('sender').where('msidn', chip_sender).select('token', 'status').asCallback((e, [result]) => {
        if (e) return console.error('[LOG ERROR] Error query sender', e)
        if (result.token < 1) {
          knex('sender').returning('id').where('msidn', chip_sender).update({
            status: 'offline'
          }).catch((e) => console.error('[LOG ERROR] Error set offline sender', e))
        }
        return result
      })

      if (parseInt(counter) === 3) {
        return knex('in_http_read').where({
          in_stat: 2,
          trx_id: trxid,
          destination: destination
        }).orderBy('in_seq', 'desc').limit(1).returning('in_seq').update({
          flag: 'Failed',
          reference: reference,
          in_stat: 5,
          x: counter
        }).catch((e) => console.error('[LOG ERROR] Error set failed', e))
      }

      if (parseInt(counter) > 5) {
        return knex('in_http_read').where({
          in_stat: 2,
          trx_id: trxid,
          destination: destination
        }).orderBy('in_seq', 'desc').limit(1).returning('in_seq').update({
          flag: 'ResendFail',
          reference: reference,
          in_stat: 7,
          x: counter
        }).catch((e) => console.error('[LOG ERROR] Error set failed', e))
      }

      if (flag === 'Sent' || flag === 'ResendOk') {
        return knex('in_http_read').where({
          in_stat: 2,
          trx_id: trxid,
          destination: destination
        }).orderBy('in_seq', 'desc').limit(1).update({
          flag: flag,
          reference: reference,
          in_stat: 4,
          x: counter
        }).asCallback((e, result) => {
          if (e) console.error('[LOG QUERY] error set success', e)
          console.log(result)
          return smsHelper.decrementToken(chip_sender)
        })
      }

      if (flag === 'Resend') {
        return knex('in_http_read').where({
          in_stat: 2,
          trx_id: trxid,
          destination: destination
        }).orderBy('in_seq', 'desc').limit(1).returning('in_seq').update({
          flag: flag,
          in_stat: 6,
          x: counter
        }).catch((e) => console.error('[LOG QUERY] error set resend', e))
      }
      return console.log('[LOG PROVIDER] Data not processed')
    })
    socket.on('report_send', function (reportObj) {
      console.log(reportObj)
      const data = reportObj.reports
      const { tpduType, reference, sender, status } = data[0]
      const smscTs = moment(data[0].smsc_ts).format('YYYY-MM-DD HH:mm:ss')
      const dischargeTs = moment(data[0].discharge_ts).format('YYYY-MM-DD HH:mm:ss')
      const chipSender = reportObj.msidn[0]

      let task = jobs.create('save_report', {
        name: 'save report to db',
        tpdu_type: tpduType,
        reference: reference,
        destination: sender,
        smsc_ts: smscTs,
        discharge_ts: dischargeTs,
        status: status,
        chip_sender: chipSender
      })
      task
        .on('complete', function () {
          console.log('Job', task.id, 'with name', task.data.name, 'is done')
        })
        .on('failed', function () {
          console.log('Job', task.id, 'with name', task.data.name, 'has failed')
        })

      task.delay(10000).save()
      jobs.process('save_report', function (task, done) {
        // console.log(task.data);
        knex.table('report').returning('status').insert({
          destination: task.data.destination,
          discharge_ts: task.data.discharge_ts,
          reference: task.data.reference,
          status: task.data.status,
          chip_sender: task.data.chip_sender
        }).then(function (result) {
          if (status === '00') {
            knex('in_http_read').where('destination', '=', task.data.destination).andWhere('reference', task.data.reference).returning('in_seq').update({
              flag: 'Delivered',
              in_stat: 4
            }).then((result) => {
              return done && done()
            }).catch((e) => console.error(e))
          }
          if (status === '40') {
            knex('in_http_read').where('destination', '=', task.data.destination).andWhere('reference', task.data.reference).returning('in_seq').update({
              flag: 'Resend',
              reference: 'Pending',
              in_stat: 6
            }).then((result) => {
              knex.raw('INSERT INTO inbox_http (in_seq, user_name, destination, message, in_time, trx_id, reference, chip_sender, in_stat, flag, x) SELECT in_seq, user_name, destination, message, in_time, trx_id, reference, chip_sender, in_stat, flag, x FROM in_http_read WHERE in_stat = ? AND flag = ? AND destination = ? LIMIT ?', [0, 'Resend', task.data.destination, 1]).then(function (result) {
                if (result.length === 0) return done && done()
                let n = result[0].affectedRows
                if (n > 0) {
                  knex.table('in_http_read').where('flag', '=', 'Resend').andWhere('destination', task.data.destination).limit(n).del().then(function (result) {
                    done && done()
                      // console.log(result)
                  }).catch((e) => console.error(e))
                  knex('users').where({
                    username: data.user
                  }).update({
                    token: knex.raw('token + 1')
                  }).then((result) => {
                    return result
                  }).catch((e) => console.error(e))
                }
              }).catch((e) => console.error(e))
              done && done()
              console.log(result)
            }).catch((e) => console.error(e))
          }
          done && done()
        }).catch((e) => console.error(e))
      })
    })
    socket.on('message_send', function (msg) {
      // console.log(msg);
      const { tpdu_type, smsc, sender, text } = msg
      if (text.length > 320) { return console.log('[LOG DATA] Text too long') }
      let msisdn = msg.msidn[0]
      let time = moment(msg.time).format('YYYY-MM-DD HH:mm:ss')
      console.log('[LOG PROVIDER]', time, '| Message in from', msg.sender, 'to', msg.msidn[0])
      knex.table('sms_in').returning('id').insert({
        smsc: smsc,
        tpdu_type: tpdu_type,
        sender: sender,
        text: text,
        time: time,
        msisdn: msisdn
      }).then(function (result) {
        return result
      }).catch((e) => console.error(e))
    })
  })

  // let restartJob = function restartClient () {
  //   appVar.autoResend = false
  //   appVar.autoProcess = false

  //   const clientId = Object.keys(io.sockets.sockets)
  //   if (clientId.length > 1) {
  //     clientId.push(clientId.splice(0, 1)[0])
  //   }
  //   io.to(clientId[0]).emit('restart_request')
  // }

  let resendJob = new cron.CronJob({
    cronTime: '*/' + appVar.heartbeatResend + ' * * * * *',
    onTick: function () {
      const startDate = moment().subtract(1, 'days').format('YYYY-MM-DD') + ' 00:00:00'
      const endDate = moment().format('YYYY-MM-DD') + ' 23:59:59'
      if (!Object.keys(io.sockets.connected).length) { return }
      knex('in_http_read').select('*').where('in_stat', 6).andWhereBetween('in_time', [startDate, endDate]).orderBy('in_seq').limit(appVar.limitProcess).asCallback((e, result) => {
        if (e) return console.error(e)
        if (!result) return null
        for (let i = 0; i < result.length; i++) {
          console.log('[LOG QUERY] row selected', result[i].in_seq)
          const inSeq = result[i].in_seq
          const trxId = result[i].trx_id
          knex.raw('INSERT INTO inbox_http (in_seq, user_name, destination, message, in_time, trx_id, reference, chip_sender, in_stat, flag, x) SELECT in_seq, user_name, destination, message, in_time, trx_id, reference, chip_sender, in_stat, flag, x FROM in_http_read WHERE in_seq = ? AND in_time BETWEEN ? AND ?', [inSeq, startDate, endDate]).asCallback((e, result) => {
            if (e) return console.log('[LOG QUERY] error copied', e)
            let n = result[0].affectedRows
            if (n > 0) {
              knex('in_http_read').where('in_seq', inSeq).andWhereBetween('in_time', [startDate, endDate]).limit(n).del().asCallback(function (e, result) {
                if (e) return console.log('[LOG QUERY] error delete', e)
                // console.log('[LOG QUERY] row deleted', result)
                return result
              })
              knex('inbox_http').where('in_stat', 6).andWhere('trx_id', trxId).limit(n).update({
                in_stat: 0
              }).asCallback((e, result) => {
                if (e) return console.log('[LOG QUERY] error update', e)
                // console.log('[LOG QUERY] row updated', result)
                return result
              })
            }
            return result
          })
        }
      })
    },
    start: false,
    timeZone: 'Asia/Jakarta'})

  let processJob = new cron.CronJob({
    cronTime: '*/' + appVar.heartbeatProcess + ' * * * * *',
    onTick: function () {
      knex.table('inbox_http').select('*').where('in_stat', '=', 0).orderBy('in_seq').limit(appVar.limitProcess).asCallback((e, rows) => {
        if (e) return console.error('[LOG QUERY] error insert row inbox_http', e)
        if (!rows) { return }
        for (var i = 0; i < rows.length; i++) {
          if (!Object.keys(io.sockets.connected).length) { return }
          const {destination, message, user_name, reference, flag, x} = rows[i]
          const inSeq = rows[i].in_seq
          const trxid = rows[i].trx_id
          const username = rows[i].user_name
          const hlr = smsHelper.getHlr(destination)
          let badNumber = null
          let goodNumber = null
          if (smsHelper.filterBadNumber(destination, hlr)) {
            badNumber = destination
            console.log('Bad number', badNumber)
          } else {
            goodNumber = destination
            console.log('Good number', goodNumber)
          }
          if (badNumber) {
            return smsHelper.getRandSender(hlr, (sender) => {
              if (!sender) { return }
              let smsc = sender
              knex('inbox_http').where({
                trx_id: trxid,
                destination: destination
              }).limit(1).returning('in_seq').update({
                in_stat: 2,
                flag: 'Sent',
                chip_sender: smsc.msidn
              }).asCallback((e, result) => {
                if (e) return console.error('[LOG QUERY] error update row inbox_http', e)
                knex.raw('INSERT INTO in_http_read (in_seq, user_name, destination, message, trx_id, reference, chip_sender, in_stat, flag, x) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [inSeq, username, badNumber, message, trxid, 'Failed', smsc.msidn, 7, 'BadNumber', x]).asCallback((e, result) => {
                  if (e) return console.error('[LOG QUERY] error delete row', e)
                  let n = result[0].affectedRows
                  if (n > 0) {
                    knex.table('inbox_http').where('in_stat', 2).andWhere('destination', badNumber).andWhere('trx_id', trxid).limit(n).del().then(function (result) {
                      // console.log('[LOG QUERY] row deleted', result)
                      return result
                    })
                  }
                })
              })
            })
          }
          smsHelper.getSender(hlr, (sender) => {
            if (!sender) { return }
            knex('inbox_http').where({
              trx_id: trxid,
              destination: destination
            }).limit(1).returning('in_seq').update({
              in_stat: 2,
              flag: 'Sent',
              chip_sender: sender.msidn
            }).asCallback((e, result) => {
              if (e) return console.error('[LOG QUERY] error update row inbox_http', e)
              knex.raw('INSERT INTO in_http_read (in_seq, user_name, destination, message, in_time, trx_id, reference, chip_sender, in_stat, flag, x) SELECT in_seq, user_name, destination, message, in_time, trx_id, reference, chip_sender, in_stat, flag, x FROM inbox_http WHERE in_stat = ? AND destination = ? AND trx_id = ? LIMIT ?', [2, goodNumber, trxid, 1]).asCallback((e, result) => {
                if (e) return console.error('[LOG QUERY] error delete row', e)
                if (result.length === 0) return result
                let n = result[0].affectedRows
                if (n > 0) {
                  knex.table('inbox_http').where('in_stat', 2).andWhere('destination', goodNumber).andWhere('trx_id', trxid).limit(n).del().then(function (result) {
                    // console.log('[LOG QUERY] row deleted', result)
                    return result
                  })
                }
              })
            })
            let text = message
            appVar.wordReplace = 1
            appVar.word = ['Tokopedia', 'Tokopedia']
            appVar.pattern = [['T\u00f2kop\u00e8di\u00e1', 'Tok\u00f2p\u00e8dia', 'T\u00f2kopedi\u00e0', 'T\u00f2koped\u00eca'], ['T\u00f2kop\u00e8di\u00e1', 'Tok\u00f2p\u00e8dia', 'T\u00f2kopedi\u00e0', 'T\u00f2koped\u00eca']]
            for (let i = 0; i < appVar.word.length; i++) {
              // console.log(appVar.word[i])
              // console.log(appVar.pattern[i])
              if (appVar.charReplace === 1) text = smsHelper.replaceChar(message, appVar.char, appVar.pattern)
              if (appVar.wordReplace === 1 && hlr === 'TSEL') text = smsHelper.replaceWord(message, appVar.word[i], _.sample(appVar.pattern[i]))
            }
            // console.log(temp)
            let data = {
              destination: destination,
              text: text,
              user: user_name,
              trxid: trxid,
              reference: reference,
              flag: flag,
              hlr: hlr,
              chip: sender.msidn,
              smsc: sender.id,
              counter: x,
              delay: sender.delay
            }
            // console.log(data)
            if (data.destination === badNumber) { return }
            const clientId = Object.keys(io.sockets.sockets)
            if (clientId.length > 1) {
              clientId.push(clientId.splice(0, 1)[0])
            }
            io.to(clientId[0]).emit('sms_request', data)
          })
        }
      })
    },
    start: false,
    timeZone: 'Asia/Jakarta'})
  let restartServ = new cron.CronJob({
    cronTime: '0 * * * *',
    onTick: function () {
      console.log('start restart device')
      restart()
    },
    start: false,
    timeZone: 'Asia/Jakarta'})
  io.on('connection', (processData) => {
    if (appVar.autoProcess) processJob.start()
    if (appVar.autoResend) resendJob.start()
    restartServ.start()
  })

  server.route([{
    method: 'POST',
    path: '/api-key',
    config: {
      description: 'Routes for generate uuid for user signature',
      handler: function (request, reply) {
          // password.hash(request.payload.pass,(hash) => {
          // console.log(hash)
          // })
        knex('users').where('username', request.payload.user).select('*').asCallback((e, [user]) => {
            // console.log(user)
          if (e) reply(Boom.serverUnavailable('Resource unavailable'))
          if (!user) {
            return reply(Boom.unauthorized('Invalid user'))
          }
          password.validate(request.payload.pass, user.password, (res) => {
            if (!res) {
              return reply(Boom.unauthorized('Invalid credential'))
            }

            // const key = aguid(user.username).toUpperCase()
            const key = uuidV4().toUpperCase()
            knex('users').where('username', request.payload.user).update({
              uuid: key
            }).asCallback((e, result) => {
              if (e) reply(Boom.serverUnavailable('Resource unavailable'))
              return reply({
                'rescode': '00',
                'status': 'OK',
                'token': key
              })
            })
          })
        })
      }
    }
  },
  {
    method: 'POST',
    path: '/device/status',
    config: {
      description: 'Routes for handle send sms',
      handler: function (request, reply) {
        console.log(request.payload)
        const {id, status} = request.payload
        if (typeof id !== 'undefined' && id) {
          if (status === 'false') {
            knex('sender').where('id', id).update({
              status: 'offline'
            })
            return reply().code(200)
          } else {
            knex('sender').where('id', id).update({
              status: 'online'
            })
            return reply().code(200)
          }
        }
      },
      validate: {
        // payload: appVarSchema
      }
    }
  },
  {
    method: 'POST',
    path: '/ussd/post',
    config: {
      description: 'Routes for handle send sms',
      handler: function (request, reply) {
        console.log(request.payload)
        const { msidn, ussd } = request.payload
        let data = {
          msidn: msidn,
          ussd: ussd
        }
        const clientId = Object.keys(io.sockets.sockets)
        if (clientId.length > 1) {
          clientId.push(clientId.splice(0, 1)[0])
        }
        io.to(clientId[0]).emit('ussd_request', data)
        reply('OK')
      },
      validate: {
        // payload: appVarSchema
      }
    }
  },
  {
    method: 'POST',
    path: '/sms/replaceWord',
    config: {
      description: 'Routes for handle send sms',
      handler: function (request, reply) {
        // console.log(request.payload)
        appVar.wordReplace = request.payload.wordReplace
        appVar.word = request.payload.word
        appVar.pattern = request.payload.pattern
        reply().code(200)
      },
      validate: {
        // payload: appVarSchema
      }
    }
  },
  {
    method: 'POST',
    path: '/sms/v1/post',
    config: {
      description: 'Routes transition for handle send sms',
      handler: function (request, reply) {
 /* 1. kirim sms
 parameter yg di kirim
 cmd = SENDSMS
 uid = userid
 nhp = nomor hp tujuan
 ref = nomor ref id mitra
 sig = signature => md5(uid.nhp.pin.ref)

 respon api
 rescode = respon kode api
 refid = nomor refid mitra
 info = berita
 */
        console.log(request.payload)
        knex('users').where('username', request.payload.uid).select('*').asCallback((e, [result]) => {
          if (e) reply(Boom.serverUnavailable('Resource unavailable'))
          if (appVar.maintenanceMode) reply(Boom.serverUnavailable('Maintenance server'))
          if (!result) {
            return reply(Boom.unauthorized('Invalid user'))
          } else {
            if (result.token < 1) {
              return reply(Boom.unauthorized('Insufficent token'))
            }
              // sig = signature => md5(uid.nhp.pin.ref)
            const { uid, nhp, ref, msg } = request.payload
            let destination = smsHelper.formatNumber(nhp)
            const hlr = smsHelper.getHlr(destination)
            const sig = uid + nhp + result.pin + ref

            if (hlr === 'no-hlr') {
              return reply(Boom.badRequest('Bad Destination'))
            }
            if (md5(sig) !== request.payload.sig) {
              return reply(Boom.unauthorized('Invalid signature'))
            }

            knex.table('inbox_http').returning('in_seq').insert({
              user_name: uid,
              destination: nhp,
              message: msg,
              trx_id: ref,
              reference: 'Pending',
              flag: 'New',
              in_stat: 0,
              chip_sender: 0,
              x: 0
            }).asCallback((e, result) => {
              if (e) reply(Boom.serverUnavailable('Resource unavailable'))
                /* update user token by trigger */
              reply({
                'rescode': '0011',
                'refid': ref,
                'info': 'SMS MASUK ANTRIAN'
              })
            })
          }
        })
      },
      validate: {
        payload: Schema.smsV1
      }
    }
  },
  {
    method: 'POST',
    path: '/sms/post',
    config: {
      description: 'Routes for handle send sms',
      handler: function (request, reply) {
        knex('users').where('username', request.payload.user).select('*').asCallback((e, [result]) => {
          if (e) {
            console.log('Query no result', request.payload.user)
            return reply(Boom.serverUnavailable('Resource unavailable'))
          }
          if (appVar.maintenanceMode) {
            console.log('Maintenance Mode')
            return reply(Boom.serverUnavailable('Maintenance server'))
          }
          if (!result) {
            console.log('Bad User', request.payload.user)
            return reply(Boom.unauthorized('Invalid user'))
          } else {
            password.validate(request.payload.pass, result.password, (res) => {
              if (!res) {
                console.log('Bad Credential', request.payload.pass)
                return reply(Boom.unauthorized('Invalid credential'))
              }
              const uuid = result.uuid
              const {user, text, trxid} = request.payload
              let destination = smsHelper.formatNumber(request.payload.destination)
              const sig = uuid + ':' + user + '@' + request.payload.destination

              if (appVar.passthroughMode) {
                const pin = '5358'
                const uid = 'MTR0096'
                const cmd = 'SENDSMS'
                const sign = md5(uid + destination + pin + trxid)
                const req = {
                  cmd: cmd,
                  uid: uid,
                  nhp: destination,
                  ref: trxid,
                  msg: text,
                  sig: sign
                }
                const method = 'POST'
                const baseUrl = 'http://180.250.246.10:8877'
                const uri = '/api_sms/'
                const options = {
                  baseUrl: baseUrl,
                  payload: JSON.stringify(req),
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  timeout: 10000
                }
                Wreck.request(method, uri, options, (e, res) => {
                  if (e) console.log(e)
                  Wreck.read(res, null, (e, body) => {
                    if (e) console.log(e)
                    console.log(body.toString())
                  })
                })
                knex.table('in_http_read').returning('in_seq').insert({
                  user_name: user,
                  destination: destination,
                  message: text,
                  trx_id: trxid,
                  reference: '0',
                  flag: 'Sent',
                  in_stat: 4,
                  chip_sender: 'GW-SPY',
                  x: 1
                }).asCallback((e, result) => {
                  if (e) return reply(Boom.serverUnavailable('Resource unavailable'))
                  /* update user token by trigger */
                })
                return reply({
                  'rescode': '00',
                  'status': 'OK',
                  'message': 'Accepted',
                  'trxid': trxid
                })
              }
              // if (result.token < 1) {
              //   return reply(Boom.unauthorized('Insufficent token'))
              // }
              // sig md5(UUID:user@destination)
              // const hlr = smsHelper.getHlr(destination)

              // if (hlr === 'no-hlr') {
              //   return reply(Boom.badRequest('Bad Destination'))
              // }
              if (md5(sig) !== request.payload.sig) {
                console.log('invalid signature', request.payload.user)
                return reply(Boom.unauthorized('Invalid signature'))
              }

              knex.table('inbox_http').returning('in_seq').insert({
                user_name: user,
                destination: destination,
                message: text,
                trx_id: trxid,
                reference: 'Pending',
                flag: 'New',
                in_stat: 0,
                chip_sender: 0,
                x: 0
              }).asCallback((e, result) => {
                if (e) {
                  console.log('query error')
                  return reply(Boom.serverUnavailable('Resource unavailable'))
                }
                /* update user token by trigger */
                reply({
                  'rescode': '00',
                  'status': 'OK',
                  'message': 'Accepted',
                  'trxid': trxid
                })
              })
            })
          }
        })
      },
      validate: {
        payload: Schema.sms
      }
    }
  },
  {
    method: 'POST',
    path: '/smsc/status',
    config: {
      description: 'Routes for handle send sms',
      handler: function (request, reply) {
        // console.log(request.payload)
        const {msisdn, sender} = request.payload
        let destination = smsHelper.formatNumber(msisdn)
        const hlr = smsHelper.getHlr(destination)
        if (sender === 'all') {
          knex('sender').select('*').asCallback((e, result) => {
            if (e) return reply().code(400)
            // console.log(result)
            for (let i = 0; i < result.length; i++) {
              let text = 'Status ' + result[i].id + 'Ok at ' + moment().format('DD-MM-YYYY HH:mm:ss')
              let data = {
                destination: destination,
                text: text,
                user: 'ADMIN',
                trxid: uuidV4(),
                hlr: hlr,
                chip: result[i].msidn,
                reference: 'Pending',
                flag: 'Status',
                counter: 1,
                delay: result[i].delay
              }
              const clientId = Object.keys(io.sockets.sockets)
              if (clientId.length > 1) {
                clientId.push(clientId.splice(0, 1)[0])
              }
              io.to(clientId[0]).emit('sms_request', data)
            }
          })
        } else {
          knex('sender').select('*').asCallback((e, result) => {
            if (e) return reply().code(400)
            // console.log(result)
            let text = 'Status Ok at ' + moment().format('DD-MM-YYYY HH:mm:ss')
            let chipSender = null
            let delay = 3
            for (let i = 0; i < result.length; i++) {
              if (result[i].id === sender) {
                text = 'Status ' + result[i].id + ' Ok at ' + moment().format('DD-MM-YYYY HH:mm:ss')
                chipSender = result[i].msidn
                delay = result[i].delay
              }
            }
            if (chipSender === null) return reply().code(404)
            let data = {
              destination: destination,
              text: text,
              user: 'ADMIN',
              trxid: uuidV4(),
              reference: 'Pending',
              hlr: hlr,
              flag: 'Status',
              delay: delay,
              counter: 1,
              chip: chipSender
            }
            console.log(data)
            const clientId = Object.keys(io.sockets.sockets)
            if (clientId.length > 1) {
              clientId.push(clientId.splice(0, 1)[0])
            }
            io.to(clientId[0]).emit('sms_request', data)
          })
        }
        reply().code(200)
      },
      validate: {
        payload: {
          msisdn: Joi.string().regex(/^((?:\+62|62)|0)[2-9]{1}[0-9]+$/).required(),
          sender: Joi.string().max(10).required()
        }
      }
    }
  },
  {
    method: 'POST',
    path: '/sms/report',
    config: {
      description: 'Routes for handle status sms',
      handler: function (request, reply) {
        knex('users').where('username', request.payload.user).select('*').asCallback((e, [user]) => {
          if (e) return console.error(e)
            // console.log(user)
          if (!user) {
            return reply(Boom.unauthorized('Invalid user'))
          }
          password.validate(request.payload.pass, user.password, (res) => {
            if (!res) {
              return reply(Boom.unauthorized('Invalid credential'))
            }
          })
          knex.table('in_http_read').select('*').where('trx_id', request.payload.trxid).asCallback((e, result) => {
            if (e) return console.error(e)
            if (!result.length) {
              return reply(Boom.badRequest('Invalid trxid', request.payload.trxid))
            }
            let payload = []
            for (let i = 0; i < result.length; i++) {
              if (result[i].reference !== 'Pending' && result[i].reference !== 'FAILED') {
                let status = 'Delivered'
                payload.push({
                  rescode: '00',
                  trxid: result[i].trx_id,
                  destination: result[i].destination,
                  status: status,
                  date: moment(result[i].in_time).format('YYYY-MM-DD HH:mm:ss')
                })
              }
            }
              // json = Object.assign({}, raw);
            return reply(payload)
          })
        })
      },
      validate: {
        payload: Schema.status
      }
    }
  },
  {
    method: 'POST',
    path: '/sms/status',
    config: {
      description: 'Routes for handle status sms',
      handler: function (request, reply) {
        knex('users').where('username', request.payload.user).select('*').asCallback((e, [user]) => {
          if (e) return console.error(e)
            // console.log(user)
          if (!user) {
            return reply(Boom.unauthorized('Invalid user'))
          }
          password.validate(request.payload.pass, user.password, (res) => {
            if (!res) {
              return reply(Boom.unauthorized('Invalid credential'))
            }
          })
          knex.table('in_http_read').select('*').where('trx_id', request.payload.trxid).asCallback((e, result) => {
            if (e) return console.error(e)
            if (!result.length) {
              return reply(Boom.badRequest('Invalid trxid', request.payload.trxid))
            }
            let payload = []
            for (let i = 0; i < result.length; i++) {
              if (result[i].reference !== 'Pending' && result[i].reference !== 'FAILED') {
                let status = 'Delivered'
                payload.push({
                  rescode: '00',
                  trxid: result[i].trx_id,
                  destination: result[i].destination,
                  status: status,
                  date: moment(result[i].in_time).format('YYYY-MM-DD HH:mm:ss')
                })
              }
            }
              // json = Object.assign({}, raw);
            return reply(payload)
          })
        })
      },
      validate: {
        payload: Schema.status
      }
    }
  }
  ])

  next()
}

exports.register.attributes = {
  name: 'HTTP-SMS Route',
  version: '1.0.0'
}
