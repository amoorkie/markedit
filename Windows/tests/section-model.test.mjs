import assert from 'node:assert/strict';
import test from 'node:test';
import { createSectionTree, sectionSource } from '../src/section-model.mjs';

const heading = (depth, raw) => ({ type: 'heading', depth, raw });
const text = raw => ({ type: 'paragraph', raw });

test('groups nested headings under their semantic parent', () => {
  const root = createSectionTree([
    heading(1, '# One\n'),
    text('intro\n'),
    heading(2, '## Child\n'),
    text('child body\n'),
    heading(1, '# Two\n'),
  ]);

  assert.equal(root.children.length, 2);
  assert.equal(root.children[0].children.length, 1);
  assert.equal(root.children[1].children.length, 0);
  assert.equal(sectionSource(root.children[0]), '# One\nintro\n## Child\nchild body\n');
});

test('keeps content before the first heading as a preamble', () => {
  const root = createSectionTree([text('preamble\n'), heading(3, '### Detail\n'), text('body\n')]);
  assert.equal(root.tokens[0].raw, 'preamble\n');
  assert.equal(sectionSource(root.children[0]), '### Detail\nbody\n');
});
