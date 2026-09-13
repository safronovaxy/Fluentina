import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";

const testMarkdown = `
# Heading 1
## Heading 2
### Heading 3
#### Heading 4

This is a paragraph with **bold text**, *italic text*, and ***bold italic text***.

You can also use __bold__ and _italic_ with underscores.

Here's some ~~strikethrough text~~.

## Lists

### Unordered List
- First item
- Second item
  - Nested item
  - Another nested item
- Third item

### Ordered List
1. First step
2. Second step
3. Third step

### Task List
- [x] Completed task
- [ ] Incomplete task
- [ ] Another task

## Links and Images

Here's a [link to Fluentina](https://fluentina.com).

Here's an internal [link to blog](/blog).

![Placeholder image](https://via.placeholder.com/800x400/6366f1/ffffff?text=Test+Image)

## Code

Inline code: \`const level = "B2"\`

Code block:
\`\`\`javascript
function assessLevel(score) {
  if (score > 80) return 'B2';
  if (score > 60) return 'B1';
  return 'A2';
}
\`\`\`

## Blockquotes

> This is a blockquote.
> It can span multiple lines.

> **Important:** This is a bold text inside a blockquote.

## Tables

| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |

### Table with Alignment

| Left | Center | Right |
|:-----|:------:|------:|
| A1   | B1     | C1    |
| A2   | B2     | C2    |

### Table with Formatting

| Feature | Free | Pro |
|---------|------|-----|
| Tasks | **3/day** | **Unlimited** |
| AI | *Basic* | *Advanced* |
| Price | €0 | [€9.99](/pricing) |

## Horizontal Rule

---

## Mixed Content

Here's a paragraph with **bold**, *italic*, \`code\`, and a [link](/about).

- List item with **bold**
- List item with *italic*
- List item with \`code\`
- List item with [link](/pricing)

> Quote with **bold text** and *italic text*

---

**End of test content**
`;

const MarkdownTest = () => {
  return (
    <>
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl">
            <div className="mb-8 rounded-lg bg-primary/10 p-6">
              <h1 className="mb-2 text-2xl font-bold text-foreground">
                Markdown Rendering Test
              </h1>
              <p className="text-muted-foreground">
                This page tests all supported Markdown elements to verify frontend rendering.
              </p>
            </div>

            <article className="prose max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                rehypePlugins={[rehypeRaw]}
              >
                {testMarkdown}
              </ReactMarkdown>
            </article>
          </div>
        </div>
      </section>
    </>
  );
};

export default MarkdownTest;
