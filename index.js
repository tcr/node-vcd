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
    if (b[k] !== null) {
      a[k] = b[k];
    }
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

  // options
  opts = opts || {}
  var ignore = {};
  if (opts.ignore) {
    opts.ignore.forEach(function (k) {
      ignore[k] = true;
    })
  }

  var s_index = -1;
  var s_changes = {}, s_changes_tmp = null;
  var s_lastSample = {};

  var fsm = state('tokenStart', {
    state: stream.state,
    s_pending: false,

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

        // initialize singleton values
        for (var k in this.state.vars) {
          s_lastSample[this.state.vars[k].name] = 0;
          s_changes[this.state.vars[k].name] = null;
        }

        stream.emit('begin', this.state);

        this.s_pending = false;
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
      if (token == '$dumpoff') { // spurious?
        return;
      }

      if ((token == '$end' || token[0] == '#') && this.s_pending) {
        stream.emit('sample', s_index, s_changes, s_lastSample);
        augment(s_lastSample, s_changes);
        this.s_pending = false;
      }

      if (token == '$end') {
        return this.goto('tokenStart');
      }
      if (token[0] == '#') {
        var index = parseInt(token.substr(1));
        this.s_pending = true;
        s_index = index;
        for (var k in s_changes) {
          s_changes[k] = null;
        }
      } else if (token[0] == '0' || token[0] == '1') {
        s_changes[this.state.vars[token.substr(1, 2)].name] = parseInt(token.substr(0, 1));
      } else if (token[0] == 'b') {
        s_changes_tmp = parseInt(token.substr(1), 2);
        this.goto('binaryId');
      }
    },

    binaryId: function (token) {
      s_changes[this.state.vars[token].name] = s_changes_tmp;
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