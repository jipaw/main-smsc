/*
 - IP Filter
 * Copyright(c) 2014 Bradley and Montgomery Inc.
 * MIT Licensed
 */

'use strict'

/**
 * Module dependencies.
 */
var _ = require('lodash')
var iputil = require('ip')
var rangeCheck = require('range_check')
var Boom = require('boom')
// var IpDeniedError = require('./deniedError')
/**
 * express-ipfilter:
 *
 * IP Filtering middleware;
 *
 * Examples:
 *
 *      var ipfilter = require('ipfilter'),
 *          ips = ['127.0.0.1'];
 *
 *      app.use(ipfilter(ips));
 *
 * Options:
 *
 *  - `mode` whether to deny or grant access to the IPs provided. Defaults to 'deny'.
 *  - `logF` Function to use for logging.
 *  - `log` console log actions. Defaults to true.
 *  - `allowPrivateIPs` whether to allow private IPs.
 *  - `allowedHeaders` Array of headers to check for forwarded IPs.
 *  - 'excluding' routes that should be excluded from ip filtering
 *
 * @param [ips] {Array} IP addresses
 * @param [opts] {Object} options
 * @api public
 */

var ips = [ '61.247.63.59', '5.189.176.218','45.76.185.154', '45.77.42.200', '156.67.218.22', '139.194.121.228', '173.212.219.222', '139.228.36.85', '127.0.0.1', '180.250.246.252', '27.50.30.113', '43.243.143.34', '54.147.102.204', '139.0.118.169', '103.253.25.56', '139.228.37.178', '139.228.127.87', '192.168.0.1/24', '202.179.188.216/29', '139.255.52.40/29', '52.74.35.225', '139.255.61.208/28', '182.253.224.176/28', '182.253.221.80/29']
// var settings = {
//   mode: 'allow'
// }

const register = function ipfilter (server, options, next) {
  var s = options.connectionLabel ? server.select(options.connectionLabel) : server
  if (!s) {
    return next('ipfilter - no server')
  }

  if (!s.connections.length) {
    return next('ipfilter - no connection')
  }

// if (s.connections.length !== 1) {
// return next('ipfilter - multiple connections');
// }

  var connection = s && s.connections.length && s.connections[0]

  if (!connection) {
    return next('No connection/listener found')
  }

  ips = ips || false

  var logger = function (message) {
    console.log(message)
  }
  var settings = _.defaults(options || {}, {
    mode: 'allow',
    log: true,
    logF: logger,
    allowedHeaders: [],
    allowPrivateIPs: false,
    excluding: [],
    detectIp: getClientIp
  })

// function getClientIp(request) {
//
// support IP recognition for nginx reverse proxy
// prefer IP received in proxied header field over local one
// take first IP (that's the client) from possible array of proxy IPs
// const xFF = request.headers['x-forwarded-for'];
// return xFF ? xFF.split(',')[0] : request.info.remoteAddress;
//
// }

  function getClientIp (request) {
// console.log(request.headers)
    var ipAddress

    var headerIp = _.reduce(settings.allowedHeaders, function (acc, header) {
      var testIp = request.headers[header]
      if (testIp !== '') {
        acc = testIp
      }

      return acc
    }, '')

    if (headerIp) {
      var splitHeaderIp = headerIp.split(',')
      ipAddress = splitHeaderIp[0]
    }

    if (!ipAddress) {
      ipAddress = request.info.remoteAddress
    }

    if (!ipAddress) {
      return ''
    }

    if (iputil.isV6Format(ipAddress) && ~ipAddress.indexOf('::ffff')) {
      ipAddress = ipAddress.split('::ffff:')[1]
    }

    return ipAddress
  }

  var matchClientIp = function (ip) {
    var mode = settings.mode.toLowerCase()
    var objIps = Object.assign({}, ips)
    // console.log(objIps)

    var result = _.invoke(objIps, testIp, ip, mode)
    // console.log(result)

    if (mode === 'allow') {
      return _.some(result)
    } else {
      return _.every(result)
    }
  }

  var testIp = function (ip, mode) {
    var constraint = this

    // Check if it is an array or a string
    if (typeof constraint === 'string') {
      if (rangeCheck.validRange(constraint)) {
        return testCidrBlock(ip, constraint, mode)
      } else {
        return testExplicitIp(ip, constraint, mode)
      }
    }

    if (typeof constraint === 'object') {
      return testRange(ip, constraint, mode)
    }
  }

  var testExplicitIp = function (ip, constraint, mode) {
    if (ip === constraint) {
      return mode === 'allow'
    } else {
      return mode === 'deny'
    }
  }

  var testCidrBlock = function (ip, constraint, mode) {
    if (rangeCheck.inRange(ip, constraint)) {
      return mode === 'allow'
    } else {
      return mode === 'deny'
    }
  }

  var testRange = function (ip, constraint, mode) {
    var filteredSet = _.filter(ips, function (constraint) {
      if (constraint.length > 1) {
        var startIp = iputil.toLong(constraint[0])
        var endIp = iputil.toLong(constraint[1])
        var longIp = iputil.toLong(ip)
        return longIp >= startIp && longIp <= endIp
      } else {
        return ip === constraint[0]
      }
    })

    if (filteredSet.length > 0) {
      return mode === 'allow'
    } else {
      return mode === 'deny'
    }
  }

  s.ext('onRequest', function (request, reply) {
    if (settings.excluding.length > 0) {
      var results = _.filter(settings.excluding, function (exclude) {
        var regex = new RegExp(exclude)
        return regex.test(request.url)
      })

      if (results.length > 0) {
        if (settings.log && settings.logLevel !== 'deny') {
          settings.logF('Access granted for excluded path: ' + results[0])
        }
        return reply.continue()
      }
    }

    var ip = settings.detectIp(request)
// console.log(request)
// If no IPs were specified, skip
// this middleware
    if (!ips || !ips.length) {
      return reply.continue()
    }

    if (matchClientIp(ip, request)) {
// Grant access
      if (settings.log && settings.logLevel !== 'deny') {
        settings.logF('Access granted to IP address: ' + ip)
      }

      return reply.continue()
    }

// Deny access
    if (settings.log && settings.logLevel !== 'allow') {
      settings.logF('Access denied to IP address: ' + ip)
    }

// var err = new IpDeniedError('Access denied to IP address: ' + ip);
    return reply(Boom.unauthorized('Unauthorized IP'))
  })
  next()
}

register.attributes = {
  name: 'ipfilter',
  version: '1.0.0'

}

module.exports = register
