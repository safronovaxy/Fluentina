# Fluentina Blog Formatting Guide

This guide explains all the Markdown formatting features available when creating blog posts in the Strapi CMS. The CMS uses **GitHub Flavored Markdown (GFM)**, which is automatically converted to styled HTML on the website.

## Quick Reference

| Element | Syntax |
|---------|--------|
| Heading 1 | `# H1` |
| Heading 2 | `## H2` |
| Heading 3 | `### H3` |
| Bold | `**bold**` or `__bold__` |
| Italic | `*italic*` or `_italic_` |
| Bold + Italic | `***text***` or `___text___` |
| Link | `[text](url)` |
| Image | `![alt text](url)` |
| Inline Code | `` `code` `` |
| Unordered List | `- item` or `* item` |
| Ordered List | `1. item` |
| Blockquote | `> quote` |
| Strikethrough | `~~text~~` |
| Task List | `- [ ] task` or `- [x] done` |

## Detailed Formatting Guide

### Headers

Use headers to organize your content hierarchically. The number of `#` symbols determines the heading level:

```markdown
# Heading 1 (H1)
## Heading 2 (H2)
### Heading 3 (H3)
#### Heading 4 (H4)
##### Heading 5 (H5)
###### Heading 6 (H6)
```

**When to use:**
- **H1 (`#`)** - Main post title (usually automatic from the title field)
- **H2 (`##`)** - Major sections (e.g., "Why Online Tests Matter")
- **H3 (`###`)** - Subsections (e.g., "Advantages of Digital Testing")
- **H4 (`####`)** - Minor points or sub-subsections

**Important:** Always put a space after the `#` symbols!

✅ Good: `## My Section`
❌ Bad: `##My Section`

### Text Styling

#### Bold
Use for emphasis on important terms, product names, or key concepts:

```markdown
**Fluentina** helps you learn faster
__Important concept__ to remember
```

Both `**text**` and `__text__` create bold text.

#### Italic
Use for subtle emphasis, foreign words, or book/article titles:

```markdown
*zeitgeist* is a German word
The book _The Art of Learning_ is excellent
```

Both `*text*` and `_text_` create italic text.

#### Bold + Italic
Use sparingly for maximum emphasis:

```markdown
***Critical point*** you must understand
___Maximum emphasis___ on this topic
```

#### Strikethrough
Use to show corrections or deprecated information:

```markdown
The test costs ~~€50~~ €40 (on sale!)
```

### Links

#### Internal Links
Link to other pages on your site:

```markdown
Check out our [pricing plans](/pricing) for more details.
Read our [previous article](/blog/german-grammar-tips).
```

#### External Links
Link to external websites:

```markdown
Learn more from [Goethe Institute](https://www.goethe.de).
The [CEFR framework](https://www.coe.int/en/web/common-european-framework-reference-languages) explains language levels.
```

**Best practices:**
- Use descriptive anchor text (not "click here")
- Keep URLs clean and meaningful
- Link to authoritative sources for credibility

### Lists

#### Unordered Lists (Bullets)
Use for items without a specific order:

```markdown
- First advantage: accessibility
- Second advantage: instant feedback
- Third advantage: adaptive difficulty
```

You can also use `*` instead of `-`:

```markdown
* First item
* Second item
* Third item
```

#### Nested Unordered Lists
Indent with 2 or 4 spaces:

```markdown
- Main item
  - Sub item
  - Another sub item
- Another main item
```

#### Ordered Lists (Numbers)
Use for sequential steps or ranked items:

```markdown
1. Take the initial assessment
2. Review your results
3. Create a study plan
4. Start your first task
```

#### Nested Ordered Lists
Mix ordered and unordered as needed:

```markdown
1. First step
   1. Sub-step A
   2. Sub-step B
2. Second step
   - Note about this step
   - Another note
```

#### Task Lists
Use for checklists (great for tutorials):

```markdown
- [ ] Complete the placement test
- [x] Review your CEFR level
- [ ] Set your learning goals
- [ ] Start your first writing task
```

### Images

Upload images through the Strapi media library first, then reference them:

```markdown
![Student taking German placement test](/uploads/test-screenshot.jpg)
```

**Image Syntax:**
- `!` - Indicates an image
- `[alt text]` - Description for SEO and accessibility
- `(url)` - Path to the image

**Best practices:**
1. **Always add descriptive alt text** (the text in square brackets)
   - ✅ Good: `![CEFR levels chart showing A1 through C2]`
   - ❌ Bad: `![image]` or `![screenshot]`
2. Use high-quality images (1200x600px for featured, 800x600px for inline)
3. Optimize file size (JPG for photos, PNG for graphics/charts)
4. Upload through Strapi's media library, then copy the URL

**Example with good alt text:**
```markdown
![Fluentina dashboard showing progress chart and recent tasks](/uploads/dashboard-screenshot.jpg)
```

### Code

#### Inline Code
Use for short code snippets, commands, or technical terms:

```markdown
Use the `CEFR scale` to assess your level.
Run the `npm install` command to get started.
The variable `currentLevel` stores your CEFR level.
```

#### Code Blocks
Use for longer code samples or multi-line content:

````markdown
```javascript
function assessLevel(score) {
  if (score > 80) return 'B2';
  if (score > 60) return 'B1';
  return 'A2';
}
```
````

**Syntax highlighting:** Specify the language after the opening ``` for proper coloring:
- `javascript` or `js`
- `python` or `py`
- `typescript` or `ts`
- `html`
- `css`
- `bash` or `shell`

**Example with syntax highlighting:**

````markdown
```python
def calculate_cefr_level(score):
    if score >= 80:
        return "B2"
    elif score >= 60:
        return "B1"
    else:
        return "A2"
```
````

### Blockquotes

Use for:
- Important callouts or warnings
- Quotes from experts or users
- Key takeaways
- Special notes or tips

```markdown
> Spoiler Alert: Not all placement tests give consistent results!

> **Pro Tip:** Take multiple tests from different providers to get an accurate average of your level.
```

**Multi-line blockquotes:**
```markdown
> Fluentina adapts to your learning style and pace.
> It's like having a personal language tutor available 24/7,
> providing instant feedback on your writing.
```

**Nested blockquotes:**
```markdown
> Main quote here
>> Nested quote here
```

### Tables

Use tables for comparisons, pricing, features, or structured data:

```markdown
| Test Provider     | Cost | Duration | Level Range |
|-------------------|------|----------|-------------|
| Goethe Institute  | Free | 15 min   | A1-C2       |
| Deutsche Welle    | Free | 30 min   | A1-C1       |
| TestDaF           | €195 | 3 hours  | B2-C1       |
```

**Column Alignment:**
```markdown
| Left Aligned | Center Aligned | Right Aligned |
|:-------------|:--------------:|--------------:|
| A1           | Beginner       | 100 words     |
| B1           | Intermediate   | 500 words     |
| C1           | Advanced       | 2000 words    |
```

- `:---` = Left aligned (default)
- `:---:` = Center aligned
- `---:` = Right aligned

**Tips:**
- Use pipes `|` to separate columns
- Use dashes `---` in the second row to separate headers
- Alignment is controlled by colons in the separator row
- Cells can contain other markdown (bold, italic, links)

**Table with formatting:**
```markdown
| Feature       | Free Plan    | Pro Plan          |
|---------------|--------------|-------------------|
| Daily Tasks   | **3 tasks**  | **Unlimited**     |
| AI Feedback   | Basic        | *Advanced*        |
| Price         | €0           | [€9.99/mo](/pricing) |
```

### Horizontal Rules

Create visual section breaks:

```markdown
---
```

or

```markdown
***
```

or

```markdown
___
```

All three create a horizontal line across the page.

### Escaping Characters

If you need to display special Markdown characters literally, escape them with a backslash `\`:

```markdown
Use \*asterisks\* to show actual asterisks (not italic)
Use \# to show a hash symbol (not a header)
Use \- to show a hyphen (not a bullet)
```

## SEO Best Practices

### Image SEO
1. **Alt text** - Describe what's in the image
   - Good: `![Student taking online German placement test on laptop]`
   - Bad: `![image1]` or `![test]`

2. **File names** - Use descriptive names before uploading
   - Good: `german-test-screenshot.jpg`
   - Bad: `IMG_1234.jpg`

3. **Image size** - Optimize for web
   - Featured images: 1200x600px (2:1 ratio)
   - Inline images: 800x600px or smaller
   - Keep file size under 200KB when possible

### Content Structure
1. **One H1 per page** - Your post title (automatic)
2. **Use H2/H3 hierarchy** - Don't skip levels (## → ####)
3. **Short paragraphs** - 2-4 sentences max for readability
4. **Link to relevant content** - Internal and external links add value
5. **Use descriptive link text** - Tell readers where the link goes

### Writing Tips
1. **Front-load important info** - Key points in first paragraph
2. **Use active voice** - "Fluentina provides feedback" not "Feedback is provided"
3. **Break up text** - Use lists, images, blockquotes for visual variety
4. **Add value** - Every paragraph should teach something or move the story forward

## Complete Example: Well-Formatted Blog Post

```markdown
## Why Online Placement Tests Matter

Choosing the right **CEFR level** for your language studies is crucial for success. Online placement tests provide a *convenient and accurate* way to assess your current abilities without the pressure of in-person testing.

![CEFR language proficiency levels chart showing progression from A1 to C2](/uploads/cefr-levels-chart.jpg)

### Top Free Placement Tests

Here are the most reliable free options available in 2025:

- **Goethe Institute** - Comprehensive test covering all four skills
- **Deutsche Welle** - Quick assessment with instant results
- **GLS Berlin** - Focus on practical communication skills
- **Online German Club** - Interactive format with adaptive difficulty

> **Spoiler Alert:** Test results can vary between providers by one CEFR level!

For more details, check out our comprehensive guide on [how to test your German level](/blog/how-to-test-your-german-level).

### Comparison Table

| Test Provider     | Cost | Duration | Level Range | Certificate |
|-------------------|------|----------|-------------|-------------|
| Goethe Institute  | Free | 15 min   | A1-C2       | ❌          |
| Deutsche Welle    | Free | 30 min   | A1-C1       | ❌          |
| TestDaF           | €195 | 3 hours  | B2-C1       | ✅          |

### Advantages of Digital Testing

1. **Instant feedback** on your performance
2. **Adaptive difficulty** based on your answers
3. **Detailed breakdown** by skill area (reading, writing, listening)
4. **Flexible scheduling** - take it anytime, anywhere
5. **No test anxiety** - comfortable home environment

#### Getting Started

Ready to find your level? Follow these steps:

- [ ] Choose a test provider from the list above
- [ ] Set aside 30-60 minutes in a quiet space
- [ ] Complete the test honestly (don't use dictionaries)
- [ ] Review your results and note your strengths
- [ ] Start learning at your assessed level

Start with the [Deutsche Welle placement test](https://www.dw.com/de/deutsch-lernen/einstufungstest/s-32523) to get your baseline level.

---

*Last updated: February 2025*
```

## Common Mistakes to Avoid

❌ **Don't:**
- Use multiple H1 headers (`#`)
- Skip heading levels (## → ####)
- Use "click here" as link text
- Forget alt text on images
- Create walls of text without breaks
- Use all caps for emphasis
- Overuse bold and italic formatting
- Mix different list markers in the same list (`-` and `*`)
- Forget the space after `#` in headers
- Leave blank lines inside lists (breaks the list)

✅ **Do:**
- Use proper Markdown hierarchy (# → ## → ### → ####)
- Add descriptive alt text to all images
- Break content into scannable sections with headers
- Use lists for clarity and easy scanning
- Link to relevant resources with descriptive text
- Optimize images before uploading
- Preview your content before publishing
- Use blank lines to separate paragraphs and sections
- Keep your markdown clean and consistent

## Testing Your Formatting

Before publishing, check that:
1. All headers are in the correct hierarchy
2. All images have descriptive alt text
3. All links work and point to the correct pages
4. Lists are properly formatted with consistent markers
5. Code blocks specify the language for syntax highlighting
6. Tables are properly aligned
7. There are no raw Markdown symbols showing (check for missing spaces after `#`)

## Need Help?

If you encounter formatting issues or have questions about the CMS editor, contact the development team.

---

**Technical Details:**
- Markdown flavor: GitHub Flavored Markdown (GFM)
- Parser: react-markdown with remark-gfm
- Renderer: Custom React components with Tailwind Typography
- Spec: https://github.github.com/gfm/
