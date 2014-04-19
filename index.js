var fs = require('fs');
var split = require('split');
var Duplex = require('stream').Duplex;

function state (initial, props) {
  var handler, cur;
  function fsm () {
    return handler.apply(fsm, arguments);
  }
  for (var key in props) {
    fsm[key] = props[key];
  }
  fsm.goto = function (name) {
    if (!fsm[name]) {
      throw new Error('unknown state ' + name);
    }
    cur = name;
    handler = fsm[name];
  }
  fsm.goto(initial);
  return fsm;
}

function augment (a, b)
{
  for (var k in b) {
    a[k] = b[k];
  }
  return a;
}

function numberlike (val)
{
  var n = Number(val);
  return String(n) == val ? n : val;
}

function keyify (arr, keys)
{
  var nu = {};
  for (var i = 0; i < arr.length; i++) {
    nu[keys[i]] = numberlike(arr[i]);
  }
  return nu;
}

function vcdStream (opts) {
  var stream = new Duplex();
  stream.state = {
    vars: {}
  };

  // ignore hash
  var ignore = {};
  if (opts.ignore) {
    opts.ignore.forEach(function (k) {
      ignore[k] = true;
    })
  }

  var fsm = state('tokenStart', {
    state: stream.state,
    lastSample: {},

    tokenStart: function (token) {
      if (token == '$dumpvars') {
        // go through options
        if (opts.rename) {
          for (var k in this.state.vars) {
            if (this.state.vars[k].name in opts.rename) {
              this.state.vars[k].name = opts.rename[this.state.vars[k].name]
            }
          }
        }
        stream.emit('begin', this.state);

        this.curvar = null;
        return this.goto('dumpvarContent');
      } else if (token) {
        this.curvar = [token.substr(1)];
        return this.goto('tokenContent');
      }
    },

    tokenContent: function (token) {
      if (token == '$end') {
        switch (this.curvar[0]) {
        case 'version':
          this.state[this.curvar[0]] = this.curvar.slice(1).join(' ');
          break;
        case 'timescale':
        case 'scope':
          this.state[this.curvar[0]] = this.curvar.slice(1);
          break;
        case 'date':
          this.state[this.curvar[0]] = new Date(Date.parse(this.curvar.slice(1).join(' '))).toJSON();
          break;
        case 'var':
          var obj = keyify(this.curvar.slice(1), ['type', 'bitwidth', 'id', 'name']);
          this.state.vars[obj.id] = obj;
          break;
        }
        return this.goto('tokenStart');
      }
      this.curvar.push(token);
    },

    dumpvarContent: function (token) {
      var endSample = (function () {
        if (!this.curvar) return;

        if (true) {
          var sample = { index: this.curvar.index, changes: {} };
          // convert ids to names
          for (var k in this.state.vars) {
            if (k in this.curvar.changes && !(this.state.vars[k].name in ignore)) {
              sample.changes[this.state.vars[k].name] = this.curvar.changes[k];
            }
          }
        } else {
          var sample = this.curvar;
        }

        stream.emit('sample', sample.index, sample.changes, this.lastSample);
        stream.push(JSON.stringify(sample));
        augment(this.lastSample, sample.changes);
      }).bind(this);

      if (token == '$dumpoff') { // spurious?
        return;
      }
      if (token == '$end') {
        endSample();
        return this.goto('tokenStart');
      }
      if (token.match(/^#/)) {
        var index = parseInt(token.substr(1));
        if (!this.curvar || this.curvar.index != index) {
          endSample();
          this.curvar = { index: index, changes: {} };
        }
      } else if (token.match(/^[01]/)) {
        this.curvar.changes[token.substr(1, 2)] = parseInt(token.substr(0, 1));
      } else if (token.match(/^[b]/)) {
        this.curvar.changes[''] = parseInt(token.substr(1), 2);
        this.goto('binaryId');
      }
    },

    binaryId: function (token) {
      this.curvar.changes[token] = this.curvar.changes[''];
      delete this.curvar.changes[''];
      this.goto('dumpvarContent');
    }
  });

  var splitter = split(/[\r\n\s]+/, fsm);
  stream._write = function (chunk, encoding, callback) {
    splitter.write(chunk);
    callback();
  };
  stream._read = function () { }
  return stream;
}

exports.createStream = vcdStream;