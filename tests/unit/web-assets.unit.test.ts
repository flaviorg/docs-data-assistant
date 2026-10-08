import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('WEB-01 app.js não usa APIs de HTML cru e index.html não tem script nem estilo inline', () => {
  const js = fs.readFileSync('src/web/app.js', 'utf8'); const html = fs.readFileSync('src/web/index.html', 'utf8');
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style\b|\sstyle\s*=|\son[a-z]+\s*=/i);
});

// Complementos
test('WEB-01 app.js não monta código a partir de texto nem usa estilo inline', () => {
  const js = fs.readFileSync('src/web/app.js', 'utf8');
  assert.doesNotMatch(js, /\beval\s*\(|new Function|setTimeout\(\s*['"`]|\.style\.|setAttribute\(\s*['"]style|setAttribute\(\s*['"]on/);
  assert.match(js, /textContent/); assert.match(js, /createElement/);
});

test('app.css tem tema escuro por prefers-color-scheme e não carrega nada de fora', () => {
  const css = fs.readFileSync('src/web/app.css', 'utf8');
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/);
});
