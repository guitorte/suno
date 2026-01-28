/**
 * Suno Data Parser
 * Extracts structured data from raw text files
 */

const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURATION
// ============================================

const RAW_DIR = path.join(__dirname, 'raw');
const PARSED_DIR = path.join(__dirname, 'parsed');
const FINAL_DIR = path.join(__dirname, 'final');

// ============================================
// UTILITY FUNCTIONS
// ============================================

function readFile(filename) {
  return fs.readFileSync(path.join(RAW_DIR, filename), 'utf-8');
}

function writeJSON(filename, data, dir = FINAL_DIR) {
  fs.writeFileSync(
    path.join(dir, filename),
    JSON.stringify(data, null, 2),
    'utf-8'
  );
  console.log(`✓ Written: ${filename}`);
}

function parseReliability(text) {
  const match = text.match(/★/g);
  return match ? match.length : 0;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ============================================
// TRICK PARSER (guide 1)
// ============================================

function parseTricks(content) {
  const tricks = [];

  // Split by trick headers - match "## " followed by anything then "TRICK #"
  const trickSections = content.split(/(?=##[^\n]*TRICK\s*#\d+)/);

  for (const section of trickSections) {
    if (!section.includes('TRICK #')) continue;

    // Extract trick number and name - flexible pattern
    const headerMatch = section.match(/##[^\n]*TRICK\s*#(\d+):\s*(.+)/);
    if (!headerMatch) continue;

    const trickNum = parseInt(headerMatch[1]);
    const trickName = headerMatch[2].trim();

    // Extract subtitle (###)
    const subtitleMatch = section.match(/###\s*(.+?)(?=\n)/);
    const subtitle = subtitleMatch ? subtitleMatch[1].trim() : '';

    // Extract reliability
    const reliabilityMatch = section.match(/\*\*Reliability:\s*(★+☆*)\s*(\w+(?:-\w+)?)\*\*/);
    const reliability = reliabilityMatch ? parseReliability(reliabilityMatch[1]) : 0;
    const reliabilityLabel = reliabilityMatch ? reliabilityMatch[2] : 'Unknown';

    // Extract day number
    const dayMatch = section.match(/Day\s*#(\d+)/);
    const day = dayMatch ? parseInt(dayMatch[1]) : null;

    // Extract "What This Trick Actually Does" section
    const whatItDoesMatch = section.match(/### What This Trick Actually Does\s*([\s\S]*?)(?=---|\n###)/);
    const whatItDoes = whatItDoesMatch ? whatItDoesMatch[1].trim() : '';

    // Extract "When This Fails" section
    const whenFailsMatch = section.match(/### When This Fails\s*([\s\S]*?)(?=---|\n###)/);
    let whenItFails = [];
    if (whenFailsMatch) {
      const failLines = whenFailsMatch[1].match(/[-❌]\s*(.+)/g);
      if (failLines) {
        whenItFails = failLines.map(line => line.replace(/^[-❌]\s*/, '').trim());
      }
    }

    // Extract "Iteration Advice" section
    const adviceMatch = section.match(/### Iteration Advice\s*([\s\S]*?)(?=---|\n##|$)/);
    let iterationAdvice = [];
    if (adviceMatch) {
      const adviceLines = adviceMatch[1].match(/[-\*]\s*\*\*(.+?)\*\*\s*[—-]\s*(.+)/g);
      if (adviceLines) {
        iterationAdvice = adviceLines.map(line => {
          const match = line.match(/[-\*]\s*\*\*(.+?)\*\*\s*[—-]\s*(.+)/);
          return match ? `${match[1]}: ${match[2]}` : line;
        });
      }
    }

    // Extract code examples (```...```)
    const codeBlocks = section.match(/```[\s\S]*?```/g) || [];
    const examples = [];

    // Look for Lyrics and Style pairs
    const lyricsMatch = section.match(/\*\*Lyrics:\*\*\s*```([\s\S]*?)```/);
    const styleMatch = section.match(/\*\*Style:\*\*\s*```([\s\S]*?)```/);

    if (lyricsMatch || styleMatch) {
      examples.push({
        lyrics: lyricsMatch ? lyricsMatch[1].trim() : null,
        style: styleMatch ? styleMatch[1].trim() : null
      });
    }

    // Extract tables as mappings
    const tables = [];
    const tableMatches = section.matchAll(/\|(.+)\|\s*\n\|[-\s|]+\|\s*\n((?:\|.+\|\s*\n)+)/g);
    for (const tableMatch of tableMatches) {
      const headers = tableMatch[1].split('|').map(h => h.trim()).filter(Boolean);
      const rows = tableMatch[2].trim().split('\n').map(row => {
        const cells = row.split('|').map(c => c.trim()).filter(Boolean);
        const obj = {};
        headers.forEach((h, i) => {
          obj[slugify(h)] = cells[i] || '';
        });
        return obj;
      });
      tables.push({ headers, rows });
    }

    tricks.push({
      id: `trick-${trickNum}`,
      number: trickNum,
      day,
      name: trickName,
      subtitle,
      reliability,
      reliabilityLabel,
      whatItDoes,
      whenItFails,
      iterationAdvice,
      examples,
      tables,
      category: categorizeTrack(trickName)
    });
  }

  return tricks.sort((a, b) => a.number - b.number);
}

function categorizeTrack(name) {
  const nameLower = name.toLowerCase();
  if (nameLower.includes('vocal') || nameLower.includes('voice') || nameLower.includes('duet')) {
    return 'vocal-control';
  }
  if (nameLower.includes('emotion') || nameLower.includes('caps')) {
    return 'emotion-dynamics';
  }
  if (nameLower.includes('live') || nameLower.includes('concert') || nameLower.includes('remix')) {
    return 'production';
  }
  if (nameLower.includes('phonetic') || nameLower.includes('pronunciation')) {
    return 'lyrics';
  }
  if (nameLower.includes('pipe') || nameLower.includes('tag') || nameLower.includes('bracket')) {
    return 'syntax';
  }
  return 'general';
}

// ============================================
// TAG PARSER (master 2 & master 3)
// ============================================

function parseTags(content2, content3) {
  const tags = [];
  const seenTags = new Set();

  // Parse categorized lists from master 2
  const categories2 = [
    { pattern: /1\.\s*Vocal Tone Tags([\s\S]*?)(?=\d+\.\s*Vocal|$)/i, category: 'vocal-tone' },
    { pattern: /2\.\s*Vocal Effects Tags([\s\S]*?)(?=\d+\.\s*|$)/i, category: 'vocal-effects' },
    { pattern: /3\.\s*Pitch & Range([\s\S]*?)(?=\d+\.\s*|$)/i, category: 'pitch-range' },
    { pattern: /4\.\s*Vocal Texture Tags([\s\S]*?)(?=\d+\.\s*|$)/i, category: 'vocal-texture' },
    { pattern: /5\.\s*Vocal Style Tags([\s\S]*?)(?=\d+\.\s*|$)/i, category: 'vocal-style' },
    { pattern: /6\.\s*Dynamics & Volume([\s\S]*?)(?=\d+\.\s*|$)/i, category: 'dynamics' },
    { pattern: /7\.\s*Emotional & Mood([\s\S]*?)(?=\d+\.\s*|$)/i, category: 'emotion-mood' },
    { pattern: /8\.\s*Vocal Timing & Rhythm([\s\S]*?)(?=\d+\.\s*|$)/i, category: 'timing-rhythm' },
  ];

  for (const { pattern, category } of categories2) {
    const match = content2.match(pattern);
    if (match) {
      // Extract individual tags (word-based lines)
      const tagLines = match[1].match(/^([A-Z][a-z][\w\s-]*?)$/gm);
      if (tagLines) {
        for (const tagName of tagLines) {
          const name = tagName.trim();
          if (name && !seenTags.has(name.toLowerCase())) {
            seenTags.add(name.toLowerCase());
            tags.push({
              id: `tag-${slugify(name)}`,
              name,
              category,
              syntax: `[${name}]`,
              source: 'master-2'
            });
          }
        }
      }
    }
  }

  // Parse drum tags from master 2
  const drumSections = [
    { pattern: /Drum Texture & Timbre([\s\S]*?)(?=⸻|Drum Rhythmic)/i, subcategory: 'texture-timbre' },
    { pattern: /Drum Rhythmic Movement([\s\S]*?)(?=⸻|Decay)/i, subcategory: 'rhythmic-movement' },
    { pattern: /Decay & Sustain([\s\S]*?)(?=⸻|Spatial)/i, subcategory: 'decay-sustain' },
    { pattern: /Spatial & Stereo([\s\S]*?)(?=⸻|Energy)/i, subcategory: 'spatial-stereo' },
    { pattern: /Energy Curve & FX([\s\S]*?)(?=⸻|___|$)/i, subcategory: 'energy-fx' },
  ];

  for (const { pattern, subcategory } of drumSections) {
    const match = content2.match(pattern);
    if (match) {
      const drumTags = match[1].match(/\[([^\]]+)\]/g);
      if (drumTags) {
        for (const tag of drumTags) {
          const name = tag.replace(/[\[\]]/g, '').trim();
          if (!seenTags.has(name.toLowerCase())) {
            seenTags.add(name.toLowerCase());
            tags.push({
              id: `tag-${slugify(name)}`,
              name,
              category: 'drums',
              subcategory,
              syntax: `[${name}]`,
              source: 'master-2'
            });
          }
        }
      }
    }
  }

  // Parse structured sections from master 3
  const sections3 = [
    { header: '# 📜 Song Structure', category: 'structure' },
    { header: '# 🌙 Mood & Atmosphere', category: 'mood-atmosphere' },
    { header: '# ⚡ Energy & Intensity', category: 'energy-intensity' },
    { header: '# 🎸 Instruments', category: 'instruments' },
    { header: '# 🎵 Genre', category: 'genre' },
    { header: '# 🎤 Vocal & Voice', category: 'vocal' },
    { header: '# 🎛️ Production & Effects', category: 'production' },
    { header: '# 🎹 Chord Progressions', category: 'harmony' },
    { header: '# 🔊 Sound Effects', category: 'sound-effects' },
    { header: '# 🎼 Musical Keys', category: 'keys-scales' },
    { header: '# 🥁 Rhythm & Tempo', category: 'rhythm-tempo' },
    { header: '# 🎯 Advanced Techniques', category: 'advanced' },
  ];

  for (let i = 0; i < sections3.length; i++) {
    const { header, category } = sections3[i];
    const nextHeader = sections3[i + 1]?.header || '# 🎯';

    const startIdx = content3.indexOf(header);
    if (startIdx === -1) continue;

    const endIdx = content3.indexOf(nextHeader, startIdx + 1);
    const sectionContent = endIdx > -1
      ? content3.slice(startIdx, endIdx)
      : content3.slice(startIdx, startIdx + 3000);

    // Extract tags with backticks: `[TagName]`
    const backtickTags = sectionContent.match(/`\[([^\]]+)\]`/g);
    if (backtickTags) {
      for (const tag of backtickTags) {
        const name = tag.replace(/[`\[\]]/g, '').trim();
        if (!seenTags.has(name.toLowerCase())) {
          seenTags.add(name.toLowerCase());

          // Try to extract description (text after the tag on same line)
          const descMatch = sectionContent.match(new RegExp(`\`\\[${escapeRegex(name)}\\]\`\\s*[-\\\\–]\\s*(.+?)(?=\\n|$)`));
          const description = descMatch ? descMatch[1].trim() : '';

          tags.push({
            id: `tag-${slugify(name)}`,
            name,
            category,
            description,
            syntax: `[${name}]`,
            source: 'master-3'
          });
        }
      }
    }
  }

  return tags;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================
// TEMPLATE PARSER (master 3)
// ============================================

function parseTemplates(content) {
  const templates = [];

  // Look for genre template sections
  const templatePatterns = [
    { name: 'Pop Ballad', pattern: /# Pop Ballad:([\s\S]*?)(?=# \w|$)/i },
    { name: 'EDM Anthem', pattern: /# EDM Anthem:([\s\S]*?)(?=# \w|$)/i },
    { name: 'Indie Folk', pattern: /# Indie Folk:([\s\S]*?)(?=# \w|$)/i },
    { name: 'Dark Electronic', pattern: /# Dark Electronic:([\s\S]*?)(?=# \w|$)/i },
  ];

  for (const { name, pattern } of templatePatterns) {
    const match = content.match(pattern);
    if (match) {
      // Extract all tags from the template text
      const templateText = match[1];
      const allTags = templateText.match(/[A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)*/g) || [];

      templates.push({
        id: `template-${slugify(name)}`,
        name,
        genre: slugify(name.split(' ')[0]),
        rawText: templateText.trim(),
        tags: [...new Set(allTags.map(t => t.trim()))].filter(t => t.length > 2)
      });
    }
  }

  // Also extract the "Practical Examples" with full prompts
  const examplePattern = /# 🌟 Example \d+:\s*"([^"]+)"\s*\(([^)]+)\)([\s\S]*?)(?=# 🌟|# 💡|$)/g;
  let exampleMatch;
  while ((exampleMatch = examplePattern.exec(content)) !== null) {
    const [, title, genre, body] = exampleMatch;

    const styleMatch = body.match(/\*\*Style Prompt:\*\*([\s\S]*?)(?=\*\*|$)/);

    templates.push({
      id: `template-${slugify(title)}`,
      name: title,
      genre: genre.toLowerCase(),
      rawText: styleMatch ? styleMatch[1].trim() : body.trim(),
      tags: []
    });
  }

  return templates;
}

// ============================================
// MAPPINGS PARSER
// ============================================

function parseMappings(content) {
  const mappings = [];

  // Find all markdown tables
  const tableRegex = /\|(.+)\|\s*\n\|[-:\s|]+\|\s*\n((?:\|.+\|\s*\n)+)/g;
  let tableMatch;
  let tableIndex = 0;

  while ((tableMatch = tableRegex.exec(content)) !== null) {
    const headers = tableMatch[1].split('|').map(h => h.trim()).filter(Boolean);
    const rowsText = tableMatch[2].trim();

    // Skip tables that are just formatting
    if (headers.length < 2) continue;
    if (headers[0].toLowerCase() === 'syntax') continue;

    const rows = rowsText.split('\n').map(row => {
      const cells = row.split('|').slice(1, -1).map(c => c.trim());
      return cells;
    }).filter(row => row.length >= 2 && row[0]);

    if (rows.length > 0) {
      mappings.push({
        id: `mapping-${tableIndex++}`,
        headers,
        entries: rows.map(row => {
          const entry = {};
          headers.forEach((h, i) => {
            entry[slugify(h)] = row[i] || '';
          });
          return entry;
        })
      });
    }
  }

  return mappings;
}

// ============================================
// CATEGORIES GENERATOR
// ============================================

function generateCategories(tags) {
  const categoryMap = new Map();

  for (const tag of tags) {
    if (!categoryMap.has(tag.category)) {
      categoryMap.set(tag.category, {
        id: tag.category,
        name: tag.category.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        subcategories: new Set(),
        tagCount: 0
      });
    }

    const cat = categoryMap.get(tag.category);
    cat.tagCount++;
    if (tag.subcategory) {
      cat.subcategories.add(tag.subcategory);
    }
  }

  return Array.from(categoryMap.values()).map(cat => ({
    ...cat,
    subcategories: Array.from(cat.subcategories)
  }));
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main() {
  console.log('🎵 Suno Data Parser\n');

  // Read raw files
  console.log('📖 Reading raw files...');
  const guide1 = readFile('suno master guide 1.txt');
  const master2 = readFile('suno master 2.txt');
  const master3 = readFile('suno master 3.txt');

  // Parse tricks
  console.log('\n🔧 Parsing tricks...');
  const tricks = parseTricks(guide1);
  console.log(`   Found ${tricks.length} tricks`);
  writeJSON('tricks.json', tricks);

  // Parse tags
  console.log('\n🏷️  Parsing tags...');
  const tags = parseTags(master2, master3);
  console.log(`   Found ${tags.length} tags`);
  writeJSON('tags.json', tags);

  // Parse templates
  console.log('\n📋 Parsing templates...');
  const templates = parseTemplates(master3);
  console.log(`   Found ${templates.length} templates`);
  writeJSON('templates.json', templates);

  // Parse mappings
  console.log('\n🗺️  Parsing mappings...');
  const allContent = guide1 + '\n' + master2 + '\n' + master3;
  const mappings = parseMappings(allContent);
  console.log(`   Found ${mappings.length} mapping tables`);
  writeJSON('mappings.json', mappings);

  // Generate categories
  console.log('\n📁 Generating categories...');
  const categories = generateCategories(tags);
  console.log(`   Found ${categories.length} categories`);
  writeJSON('categories.json', categories);

  // Generate combined index for search
  console.log('\n🔍 Generating search index...');
  const searchIndex = [
    ...tricks.map(t => ({
      id: t.id,
      type: 'trick',
      name: t.name,
      searchText: `${t.name} ${t.subtitle} ${t.whatItDoes}`.toLowerCase(),
      category: t.category,
      reliability: t.reliability
    })),
    ...tags.map(t => ({
      id: t.id,
      type: 'tag',
      name: t.name,
      searchText: `${t.name} ${t.description || ''} ${t.category}`.toLowerCase(),
      category: t.category
    })),
    ...templates.map(t => ({
      id: t.id,
      type: 'template',
      name: t.name,
      searchText: `${t.name} ${t.genre} ${t.rawText}`.toLowerCase(),
      category: 'template'
    }))
  ];
  writeJSON('search-index.json', searchIndex);

  // Summary
  console.log('\n✅ Parsing complete!');
  console.log('─'.repeat(40));
  console.log(`   Tricks:     ${tricks.length}`);
  console.log(`   Tags:       ${tags.length}`);
  console.log(`   Templates:  ${templates.length}`);
  console.log(`   Mappings:   ${mappings.length}`);
  console.log(`   Categories: ${categories.length}`);
  console.log(`   Search idx: ${searchIndex.length} entries`);
  console.log('─'.repeat(40));
}

main().catch(console.error);
