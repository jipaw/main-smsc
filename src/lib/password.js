const crypto = require('crypto')
// const bcrypt = require('bcrypt')

const SaltLength = 9

function createHash (password, callback) {
  var salt = generateSalt(SaltLength)
  var hash = md5(password + salt)
  callback(salt + hash)
};

function md5 (string) {
  return crypto.createHash('md5').update(string).digest('hex')
}

function validateHash (password, hash, callback) {
  var salt = hash.substr(0, SaltLength)
  var validHash = salt + md5(password + salt)
  callback(hash === validHash)
}

function generateSalt (len) {
  let set = '0123456789abcdefghijklmnopqurstuvwxyzABCDEFGHIJKLMNOPQURSTUVWXYZ',
    setLen = set.length,
    salt = ''
  for (var i = 0; i < len; i++) {
    var p = Math.floor(Math.random() * setLen)
    salt += set[p]
  }
  return salt
}

// function bcrypt_hash (password, callback) {
//   const saltRounds = 5
//   bcrypt.hash(password, saltRounds, function (err, hash) {
//     if (err) console.error('Error hash password', err)
//     callback(hash)
//   })
// }
// 
// function bcrypt_compare (password, hash, callback) {
//   bcrypt.compare(password, hash, function (err, res) {
//     // console.log(res)
//     callback(res)
//   })
// }

module.exports = {
  'hash': createHash,
  'validate': validateHash
}
