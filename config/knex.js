module.exports = require('knex')({
  client: 'mysql',
  connection: {
    host: 'localhost',
    user: 'fserv',
    password: 'Ikqtaksd@1',
    database: 'fserv',
    charset: 'utf8'
  },
  pool: { min: 0, max: 20 },
  acquireTimeoutMillis: 120000
})
