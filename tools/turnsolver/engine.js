// The engine the turn solver plans against: the repo's, unmodified. One
// require site so that a faster (memoised) build can be substituted in one
// place — the blow table asks `waterControlled` thousands of times per board.
'use strict';
module.exports = require('../../web/engine.js');
