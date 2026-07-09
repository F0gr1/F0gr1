#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const inputPath = 'profile-3d-contrib/profile-night-view.svg';
const outputPath = 'profile-3d-contrib/profile-language.svg';
const graphqlEndpoint = 'https://api.github.com/graphql';
const otherLanguage = {
  name: 'Other',
  color: '#64748b',
};

const username = process.env.USERNAME || process.env.GITHUB_REPOSITORY_OWNER;
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!username) {
  throw new Error('USERNAME or GITHUB_REPOSITORY_OWNER is required.');
}

if (!token) {
  throw new Error('GITHUB_TOKEN or GH_TOKEN is required.');
}

const query = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
        commitContributionsByRepository(maxRepositories: 100) {
          repository {
            primaryLanguage {
              name
              color
            }
          }
          contributions(first: 100) {
            nodes {
              occurredAt
              commitCount
            }
          }
        }
      }
    }
  }
`;

const response = await fetch(graphqlEndpoint, {
  method: 'POST',
  headers: {
    authorization: `bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ query, variables: { login: username } }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL request failed: ${response.status}`);
}

const payload = await response.json();
if (payload.errors?.length) {
  throw new Error(payload.errors.map((error) => error.message).join('\n'));
}

const collection = payload.data?.user?.contributionsCollection;
if (!collection) {
  throw new Error(`No contribution data found for ${username}.`);
}

const days = collection.contributionCalendar.weeks.flatMap((week) =>
  week.contributionDays,
);

const languageCountsByDate = new Map();
const languageByKey = new Map();

for (const repo of collection.commitContributionsByRepository) {
  const language = repo.repository.primaryLanguage;
  if (!language?.name || !language?.color) {
    continue;
  }

  const key = language.name;
  languageByKey.set(key, language);

  for (const node of repo.contributions.nodes) {
    const date = node.occurredAt.slice(0, 10);
    const dateCounts = languageCountsByDate.get(date) || new Map();
    dateCounts.set(key, (dateCounts.get(key) || 0) + node.commitCount);
    languageCountsByDate.set(date, dateCounts);
  }
}

const dominantLanguageByDate = new Map();
for (const day of days) {
  const counts = languageCountsByDate.get(day.date);
  if (!counts) {
    if (day.contributionCount > 0) {
      dominantLanguageByDate.set(day.date, otherLanguage);
    }
    continue;
  }

  const [dominantKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  dominantLanguageByDate.set(day.date, languageByKey.get(dominantKey));
}

const languages = [...dominantLanguageByDate.values()].reduce((items, lang) => {
  if (!items.some((item) => item.name === lang.name)) {
    items.push(lang);
  }
  return items;
}, []);

const languageClassByName = new Map(
  languages.map((language, index) => [language.name, `lang-${index}`]),
);

const languageStyles = languages
  .map((language) => {
    const className = languageClassByName.get(language.name);
    const top = normalizeHex(language.color);
    const left = shade(top, 0.82);
    const right = shade(top, 0.68);

    return [
      `.${className}-top { fill: ${top}; }`,
      `.${className}-left { fill: ${left}; }`,
      `.${className}-right { fill: ${right}; }`,
    ].join('\n');
  })
  .join('\n');

const barGroupPattern = /<g transform="translate\([^)]*\)">(?:<animateTransform[\s\S]*?<\/animateTransform>)?<rect[^>]*class="cont-top-\d"[^>]*>[\s\S]*?<\/rect><rect[^>]*class="cont-left-\d"[^>]*>[\s\S]*?<\/rect><rect[^>]*class="cont-right-\d"[^>]*>[\s\S]*?<\/rect><\/g>/g;
const svg = await readFile(inputPath, 'utf8');
const barGroups = svg.match(barGroupPattern) || [];

if (barGroups.length > days.length) {
  throw new Error(
    `Expected at most ${days.length} contribution bars, found ${barGroups.length}.`,
  );
}

const svgDays = days.slice(0, barGroups.length);
if (svgDays.length !== days.length) {
  console.warn(
    `Using ${svgDays.length} days to match ${inputPath}; API returned ${days.length} days.`,
  );
}

let groupIndex = 0;
const languageSvg = svg
  .replace('</style>', `\n${languageStyles}</style>`)
  .replace(barGroupPattern, (group) => {
    const day = svgDays[groupIndex];
    groupIndex += 1;

    if (!day) {
      return group;
    }

    const language = dominantLanguageByDate.get(day.date);
    if (!language) {
      return group;
    }

    const className = languageClassByName.get(language.name);
    return group
      .replace(/class="cont-top-\d"/, `class="${className}-top"`)
      .replace(/class="cont-left-\d"/, `class="${className}-left"`)
      .replace(/class="cont-right-\d"/, `class="${className}-right"`);
  });

await writeFile(outputPath, languageSvg);
console.log(`Generated ${outputPath} with ${languages.length} language colors.`);

function normalizeHex(hex) {
  const value = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }

  return otherLanguage.color;
}

function shade(hex, ratio) {
  const value = normalizeHex(hex).slice(1);
  const rgb = [0, 2, 4].map((offset) =>
    Math.round(parseInt(value.slice(offset, offset + 2), 16) * ratio),
  );

  return `#${rgb.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}
