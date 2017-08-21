const Joi = require('joi')

const smsSchema = {
  destination: Joi.string().min(10).max(16).required(),
  text: Joi.string().min(1).max(320).required(),
  user: Joi.string().min(3).max(18).required(),
  pass: Joi.string().min(4).max(18).required(),
  trxid: Joi.string().min(8).max(64).required(),
  sig: Joi.string().min(32).max(64).required()
}

const smsV1Schema = {
  cmd: Joi.string().min(5).max(8).required(),
  uid: Joi.string().min(3).max(18).required(),
  nhp: Joi.string().min(10).max(16).required(),
  msg: Joi.string().min(1).max(320).required(),
  ref: Joi.string().min(8).max(64).required(),
  sig: Joi.string().min(32).max(64).required()
}

const statusSchema = {
  user: Joi.string().min(3).max(18).required(),
  pass: Joi.string().min(4).max(18).required(),
  trxid: Joi.string().min(6).max(32).required(),
  date: [Joi.string().min(6).max(8)]
}

const keySchema = {
  user: Joi.string().required(),
  pass: Joi.string().required()
}

const autoResend = {
  status: Joi.boolean().required()
}

const autoProcess = {
  status: Joi.boolean().required()
}

const deviceStatus = {
  id: Joi.string().min(3).max(80).required(),
  status: Joi.boolean().required()
}

module.exports = {
  sms: smsSchema,
  smsV1: smsV1Schema,
  key: keySchema,
  status: statusSchema,
  deviceStatus: deviceStatus,
  autoResend: autoResend,
  autoProcess: autoProcess
}
