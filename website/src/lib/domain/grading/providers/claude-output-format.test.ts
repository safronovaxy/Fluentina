/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { GRADING_ANNOTATION_SEVERITIES, RUBRIC_DIMENSIONS } from '@/lib/contracts/grading';
import { gradingOutputFormat, sanitiseSchemaForStructuredOutputs } from './claude-output-format';

type Json = Record<string, unknown>;

/** Every schema node (objects reached through `properties`, `items`, ...), so an assertion can't pass by only checking the top level. */
function allNodes(node: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(node)) {
    node.forEach((n) => allNodes(n, out));
  } else if (typeof node === 'object' && node !== null) {
    out.push(node as Json);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties') Object.values(value as Json).forEach((n) => allNodes(n, out));
      else allNodes(value, out);
    }
  }
  return out;
}

describe('gradingOutputFormat — KAN-44, structured outputs derived from providerGradingResponseSchema', () => {
  const format = gradingOutputFormat();
  const schema = format.schema as Json;
  const properties = schema.properties as Record<string, Json>;

  it('is the output_config.format shape: type json_schema with a schema object', () => {
    expect(format.type).toBe('json_schema');
    expect(schema.type).toBe('object');
  });

  it('contains none of the keywords the API rejects with a 400', () => {
    const banned = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', '$schema'];
    for (const node of allNodes(schema)) {
      for (const key of banned) expect(node, `unsupported keyword "${key}" left in the wire schema`).not.toHaveProperty(key);
      if ('minItems' in node) expect(node.minItems as number).toBeLessThanOrEqual(1);
    }
  });

  it('sets additionalProperties: false on every object, as the API requires', () => {
    const objects = allNodes(schema).filter((n) => n.type === 'object');
    expect(objects.length).toBeGreaterThanOrEqual(3);
    for (const node of objects) expect(node.additionalProperties).toBe(false);
  });

  it('keeps the enums, taken from the contract constants — the SDK transformer would have dropped them into a description', () => {
    const dimension = (properties.dimensions.items as Json).properties as Record<string, Json>;
    const annotation = (properties.annotations.items as Json).properties as Record<string, Json>;
    expect(dimension.dimension.enum).toEqual([...RUBRIC_DIMENSIONS]);
    expect(annotation.dimension.enum).toEqual([...RUBRIC_DIMENSIONS]);
    expect(annotation.severity.enum).toEqual([...GRADING_ANNOTATION_SEVERITIES]);
  });

  it('requires the four top-level fields and leaves an annotation suggestion optional, matching the Zod schema', () => {
    expect(schema.required).toEqual(['overallScore', 'dimensions', 'annotations', 'summary']);
    expect((properties.annotations.items as Json).required).not.toContain('suggestion');
  });

  it('tells the model about the constraints it can no longer be told structurally', () => {
    const quote = ((properties.annotations.items as Json).properties as Record<string, Json>).quote;
    expect(quote.description).toContain('maxLength 1000');
    expect(properties.overallScore.description).toContain('maximum 100');
  });
});

describe('sanitiseSchemaForStructuredOutputs', () => {
  it('strips a keyword but never a FIELD that happens to share its name', () => {
    const result = sanitiseSchemaForStructuredOutputs({
      type: 'object',
      properties: { maxLength: { type: 'integer', minimum: 0 }, name: { type: 'string', maxLength: 5 } },
      required: ['maxLength', 'name'],
      additionalProperties: false,
    }) as Json;
    const props = result.properties as Record<string, Json>;
    expect(Object.keys(props)).toEqual(['maxLength', 'name']);
    expect(props.maxLength).not.toHaveProperty('minimum');
    expect(props.name).not.toHaveProperty('maxLength');
  });

  it('keeps minItems 0 and 1, which the API supports, and drops larger values', () => {
    expect(sanitiseSchemaForStructuredOutputs({ type: 'array', minItems: 1 })).toEqual({ type: 'array', minItems: 1 });
    expect(sanitiseSchemaForStructuredOutputs({ type: 'array', minItems: 4 })).toEqual({ type: 'array', description: '(minItems 4)' });
  });
});
