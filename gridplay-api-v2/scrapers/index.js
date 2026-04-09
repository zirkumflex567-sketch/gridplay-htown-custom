'use strict';
const pmvhaven = require('./pmvhaven');
const xvideos = require('./xvideos');
const xhamster = require('./xhamster');
const youporn = require('./youporn');
const fuq = require('./fuq');
const eporner = require('./eporner');
const hqporner = require('./hqporner');
const tnaflix = require('./tnaflix');

const all = [pmvhaven, xvideos, xhamster, youporn, fuq, eporner, hqporner, tnaflix];
const byId = new Map(all.map((site) => [site.id, site]));

module.exports = { all, byId };
