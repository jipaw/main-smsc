const Path = require('path')
const Glue = require('glue')
const Hoek = require('hoek')

const manifest = require('./config/manifest')
const options = {
  relativeTo: Path.join(__dirname, 'src')
}

if (process.env.NODE_ENV !== 'production') {
  manifest.registrations.push({
    plugin: 'blipp'
  })
}

Glue.compose(manifest, options, function (err, server) {
  Hoek.assert(!err, err)
  server.start(err => {
    Hoek.assert(!err, err)
    console.log('Server started at: ' + server.info.uri)
  })
})
