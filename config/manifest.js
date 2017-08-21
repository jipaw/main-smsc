module.exports = {
  server: {
    app: {
      slogan: 'NSMSC SERVER'
    }
  },
  connections: [{
    port: 2124,
    labels: ['api-sms']
  },
  ],
  registrations: [{
    plugin: 'hapi-io',
    options: {
      select: ['api-sms']
    }
  },
  {
    plugin: {
      register: 'good',
      options: {
        reporters: {
          myConsoleReport: [{
            module: 'good-squeeze',
            name: 'Squeeze',
            args: [{
              log: ['error', 'warn'],
              response: '*'
            }]
          },
          {
            module: 'good-console',
            args: [{ format: 'YYYY/MM/DD HH-mm-ss' }]
          },
            'stdout'
          ]
        }
      }
    }
  },
  {
    plugin: './module/main/index',
    options: {
      select: ['api-sms']
    }
  },
  {
    plugin: './module/ip_filter/ipfilter',
    options: {
      select: ['api-sms']
    }
  }
  ]
}
