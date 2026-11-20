#!/usr/bin/env node
/**
 * news-image-20261120 — entry builder.
 *
 * Reads entry.png that sits beside this file, validates it against the bounty
 * gate (PNG, <= 1 MiB, <= 1024x1024), then copies it to
 *   ${MAKEFUN_OUTPUT_DIR:-/output}/entry.png
 * which is the exact path the grader reads after `node main.ts`.
 *
 * No third-party dependencies: the PNG header is parsed by hand.
 *
 * Usage:
 *   node main.ts              validate, then write <output>/entry.png
 *   node main.ts --check      validate only, print size + dimensions, write nothing
 *   node main.ts --help       this text
 *
 * Exit codes: 0 ok · 1 output write error · 2 image fails a gate limit
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 1024 * 1024;
const MAX_DIM = 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const here = __dirname;
const source = path.join(here, 'entry.png');
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const destination = path.join(outputDir, 'entry.png');

/**
 * Validate the PNG and return its real dimensions.
 * Throws Error with a human readable reason on every failed check.
 * @param {string} file
 * @returns {{width: number, height: number, bytes: number}}
 */
function inspect(file) {
  if (!fs.existsSync(file)) {
    throw new Error('missing image: ' + file);
  }

  const stat = fs.statSync(file);
  if (!stat.isFile()) {
    throw new Error('not a regular file: ' + file);
  }
  if (stat.size === 0) {
    throw new Error('empty file: ' + file);
  }
  if (stat.size > MAX_BYTES) {
    throw new Error(
      'image too large: ' + stat.size + ' bytes exceeds the ' + MAX_BYTES + ' byte (1 MiB) limit'
    );
  }

  const head = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  try {
    const read = fs.readSync(fd, head, 0, 24, 0);
    if (read < 24) {
      throw new Error('truncated file: only ' + read + ' bytes, need at least 24 for the PNG header');
    }
  } finally {
    fs.closeSync(fd);
  }

  if (!head.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG: signature mismatch (expected 89 50 4e 47 0d 0a 1a 0a)');
  }

  const ihdrLength = head.readUInt32BE(8);
  const ihdrType = head.subarray(12, 16).toString('ascii');
  if (ihdrType !== 'IHDR' || ihdrLength !== 13) {
    throw new Error('malformed PNG: first chunk is ' + JSON.stringify(ihdrType) + ' length ' + ihdrLength);
  }

  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  if (width < 1 || height < 1) {
    throw new Error('malformed PNG: IHDR reports ' + width + 'x' + height);
  }
  if (width > MAX_DIM || height > MAX_DIM) {
    throw new Error(
      'image too big: ' + width + 'x' + height + ' exceeds the ' + MAX_DIM + 'x' + MAX_DIM + ' limit'
    );
  }

  return { width: width, height: height, bytes: stat.size };
}

function fail(file, message) {
  console.error('FAILED: ' + file + ' — ' + message);
  console.error('Gate: one PNG, max ' + MAX_BYTES + ' bytes, max ' + MAX_DIM + 'x' + MAX_DIM + ' pixels.');
  process.exit(2);
}

function main(argv) {
  const flags = argv.slice(2);
  const known = ['--check', '--help', '-h'];

  const unknown = flags.filter(function (flag) { return known.indexOf(flag) === -1; });
  if (unknown.length > 0) {
    console.error('unknown argument: ' + unknown.join(' ') + ' (try --help)');
    process.exit(2);
  }

  if (flags.indexOf('--help') !== -1 || flags.indexOf('-h') !== -1) {
    console.log('usage: node main.ts [--check]');
    console.log('  (no flag)  validate entry.png, write ' + destination + ' (or $MAKEFUN_OUTPUT_DIR)');
    console.log('  --check    validate only, print dimensions and size, write nothing');
    console.log('exit codes: 0 ok, 1 write error, 2 image fails a gate limit');
    process.exit(0);
  }

  let info;
  try {
    info = inspect(source);
  } catch (error) {
    fail(source, error.message);
    return;
  }

  const dims = info.width + 'x' + info.height;

  if (flags.indexOf('--check') !== -1) {
    console.log('checked ' + source + ' ' + dims + ' ' + info.bytes + ' bytes (nothing written)');
    process.exit(0);
  }

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.copyFileSync(source, destination);
  } catch (error) {
    console.error('FAILED: could not write ' + destination + ' — ' + error.message);
    process.exit(1);
    return;
  }

  console.log('wrote ' + destination + ' ' + dims + ' ' + info.bytes + ' bytes');
  process.exit(0);
}

main(process.argv);
