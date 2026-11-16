/** Starting files for a new ticket. The router fills them in during the planning interview. */

export function specTemplate(id: string, title: string, deps: { id: string; title: string }[]): string {
  const depends = deps.length ? deps.map((d) => `- ${d.id}: ${d.title}`).join("\n") : "- none";
  return `# ${id}: ${title}

## Goal

<!-- One paragraph: what this ticket delivers and why. -->

## What to change

<!-- Files, modules, behaviour. Detailed enough that a worker never needs to ask. -->

## What not to touch

<!-- Files and areas outside this ticket. -->

## Decisions

<!-- Every decision made in the interview. -->

## Depends on

${depends}
`;
}

export function evalTemplate(id: string, title: string): string {
  return `# Eval ${id}: ${title}

## How to run

<!-- Setup the checks need. Commands run from the ticket's worktree. -->

## Checks

<!--
sa ready refuses this ticket until the list below has at least one check
with type: command. Example:

- id: C1
  type: command        # command | browser | rubric
  run: npm test -- tags
  expect: exit 0
-->

\`\`\`yaml
[]
\`\`\`

## Unusual cases

<!-- Edge cases the checks cover, or that a person should look at. -->

## Done means

<!-- One sentence. -->
`;
}
