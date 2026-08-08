export function createSectionTree(tokens) {
  const root = { level: 0, tokens: [], children: [] };
  const stack = [root];

  for (const token of tokens) {
    if (token.type !== 'heading') {
      stack.at(-1).tokens.push(token);
      continue;
    }

    while (stack.at(-1).level >= token.depth) stack.pop();
    const section = {
      level: token.depth,
      tokens: [token],
      children: [],
    };
    stack.at(-1).children.push(section);
    stack.push(section);
  }

  return root;
}

export function sectionSource(section) {
  return [
    ...section.tokens.map(token => token.raw ?? ''),
    ...section.children.map(sectionSource),
  ].join('');
}
