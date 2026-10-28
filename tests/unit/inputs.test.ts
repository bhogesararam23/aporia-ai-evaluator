import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateCitationDraftInput,
  validateClaimRevisionInput,
  validateConfirmationName,
  validateEntityInput,
  validateEvidenceWithRelationInput,
  validateObservationAssessmentDraftInput,
  validateObservationDraftInput,
  validateProjectInput,
  validateProjectUpdateInput,
  validatePropositionAssessmentInput,
  validatePropositionInput,
  validateQueryDraftInput,
  validateQuerySetApprovalInput,
  validateQuerySetInput,
  validateReasonInput,
  validateRelationshipChangeInput,
  validateReportInput,
  validateReviewerName,
  validateRunInput,
  validateSourceInput,
} from '../../src/core/inputs.ts';

function expectOk<T>(
  result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] },
): T {
  if (!result.ok) {
    assert.fail(`Expected success, received ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

function expectIssue(
  result: { ok: boolean; issues?: readonly { field: string; message: string }[] },
  field: string,
): void {
  assert.equal(result.ok, false);
  assert.ok(
    result.issues?.some((issue) => issue.field === field),
    `missing issue for ${field}`,
  );
}

test('project validation accepts optional target entity and normalizes the domain', () => {
  const project = expectOk(
    validateProjectInput({
      name: '  Aporia  ',
      description: 'Evidence first.',
      primaryDomain: 'https://example.com',
      targetEntityName: 'Ram',
      targetEntityType: 'PERSON',
    }),
  );
  assert.equal(project.name, 'Aporia');
  assert.equal(project.primaryDomain, 'https://example.com/');
  assert.deepEqual(project.targetEntity, { name: 'Ram', type: 'PERSON' });

  const withoutEntity = expectOk(validateProjectInput({ name: 'Empty project' }));
  assert.equal(withoutEntity.targetEntity, null);
  assert.equal(withoutEntity.description, undefined);
});

test('project validation rejects partial entity data and unsafe domains', () => {
  expectIssue(validateProjectInput({ name: 'A', targetEntityName: 'Ram' }), 'targetEntityName');
  expectIssue(validateProjectInput({ name: 'A', targetEntityType: 'PERSON' }), 'targetEntityName');
  expectIssue(
    validateProjectInput({ name: 'A', primaryDomain: 'javascript:alert(1)' }),
    'primaryDomain',
  );
});

test('entity validation parses lists and rejects unsafe URLs', () => {
  const entity = expectOk(
    validateEntityInput({
      type: 'PERSON',
      canonicalName: 'Ram Bhogesara',
      alternateNames: 'Ram\nR. B.\nRam',
      publicUrls: 'https://example.com\nhttps://github.com/example',
      identityStatus: 'SELF_DECLARED',
      identityMethod: 'Operator declaration; no independent verification.',
      notes: 'Local record.',
    }),
  );
  assert.deepEqual(entity.alternateNames, ['Ram', 'R. B.']);
  assert.deepEqual(entity.publicUrls, ['https://example.com/', 'https://github.com/example']);

  const unsafe = validateEntityInput({
    type: 'PERSON',
    canonicalName: 'Ram',
    publicUrls: 'javascript:alert(1)',
    identityStatus: 'UNVERIFIED',
  });
  expectIssue(unsafe, 'publicUrls');
});

test('claim revision validation requires reviewable text and a locale', () => {
  const claim = expectOk(
    validateClaimRevisionInput({
      text: 'The repository implements the described feature.',
      sourceUrl: 'https://example.com/repo',
      intendedMeaning: 'Feature is present in the published release.',
      timeScope: 'Release 1.0',
      locale: 'en',
    }),
  );
  assert.equal(claim.locale, 'en');
  expectIssue(validateClaimRevisionInput({ text: 'short', locale: 'en' }), 'text');
  expectIssue(
    validateClaimRevisionInput({ text: 'A sufficiently long claim.', locale: 'bad locale' }),
    'locale',
  );
});

test('proposition validation requires evidence requirements', () => {
  const proposition = expectOk(
    validatePropositionInput({
      text: 'Repository R contains feature F.',
      subject: 'Repository R',
      predicate: 'contains',
      objectValue: 'feature F',
      evidenceRequirements: 'Release tag and test log.',
      expectedAnswerCriterion: 'Names feature F in repository R.',
    }),
  );
  assert.equal(proposition.evidenceRequirements, 'Release tag and test log.');
  expectIssue(validatePropositionInput({ text: 'Feature F exists.' }), 'evidenceRequirements');
});

test('source validation accepts a local artifact without a URL', () => {
  const source = expectOk(
    validateSourceInput({
      title: 'Local release archive',
      sourceType: 'PRIMARY_ARTIFACT',
      accessRoute: 'LOCAL_FILE',
      retrievedAt: '2026-10-28T12:00:00Z',
      publicationDate: '2026-10-01',
      language: 'en',
      independence: 'INDEPENDENT',
    }),
  );
  assert.equal(source.canonicalUri, undefined);
  assert.equal(source.publicationDate, '2026-10-01');

  expectIssue(
    validateSourceInput({
      title: 'Bad date',
      sourceType: 'OTHER',
      accessRoute: 'MANUAL_ENTRY',
      retrievedAt: '2026-10-28T12:00:00Z',
      publicationDate: '2026-02-30',
      language: 'en',
      independence: 'UNKNOWN',
    }),
    'publicationDate',
  );
});

test('evidence relationship validation requires a locator, excerpt, rationale, and reviewer', () => {
  const evidence = expectOk(
    validateEvidenceWithRelationInput({
      locator: 'README section 1',
      excerpt: 'Feature F is implemented and tested.',
      extractionMethod: 'PASTED_TEXT',
      extractedAt: '2026-10-28T12:00:00Z',
      relation: 'SUPPORTS',
      rationale: 'The passage directly states the proposition.',
      reviewer: 'Ram',
    }),
  );
  assert.equal(evidence.relation, 'SUPPORTS');
  expectIssue(
    validateEvidenceWithRelationInput({
      locator: '',
      excerpt: '',
      extractionMethod: 'PASTED_TEXT',
      extractedAt: '2026-10-28T12:00:00Z',
      relation: 'SUPPORTS',
      rationale: '',
      reviewer: '',
    }),
    'locator',
  );
});

test('relationship correction validation rejects an unknown relation', () => {
  expectIssue(
    validateRelationshipChangeInput({ relation: 'MAYBE', rationale: 'Because.', reviewer: 'Ram' }),
    'relation',
  );
  expectOk(
    validateRelationshipChangeInput({
      relation: 'QUALIFIES',
      rationale: 'The claim holds only for release 1.0.',
      reviewer: 'Ram',
    }),
  );
});

test('proposition assessment validation uses the controlled status vocabulary', () => {
  expectOk(
    validatePropositionAssessmentInput({
      label: 'PARTIALLY_SUPPORTED',
      rationale: 'Only release 1.0 is supported.',
      reviewer: 'Ram',
    }),
  );
  expectIssue(
    validatePropositionAssessmentInput({ label: 'TRUE', rationale: 'x', reviewer: 'Ram' }),
    'label',
  );
});

test('query set and query validation enforce versioned design fields', () => {
  expectOk(validateQuerySetInput({ name: 'Core discovery', locale: 'en-GB' }));
  const query = expectOk(
    validateQueryDraftInput({
      text: 'What is Project A?',
      intent: 'IDENTITY',
      branded: 'on',
      expectedElements: 'Project A and its creator.',
      inclusionRationale: 'Baseline entity question.',
    }),
  );
  assert.equal(query.branded, true);
  expectIssue(
    validateQueryDraftInput({
      text: 'What is Project A?',
      intent: 'IDENTITY',
      expectedElements: '',
      inclusionRationale: '',
    }),
    'expectedElements',
  );
});

test('query set approval requires a reviewer', () => {
  expectOk(validateQuerySetApprovalInput({ reviewer: 'Ram', note: 'Reviewed.' }));
  expectIssue(validateQuerySetApprovalInput({ reviewer: '' }), 'reviewer');
});

test('run validation checks the capture window and provider conditions', () => {
  const run = expectOk(
    validateRunInput({
      name: 'Manual baseline',
      providerLabel: 'Example assistant',
      interfaceLabel: 'Consumer web interface',
      groundingMode: 'SEARCH_GROUNDED',
      locale: 'en',
      captureFrom: '2026-10-28T10:00:00Z',
      captureTo: '2026-10-28T12:00:00Z',
      conditions: 'Manual capture, logged in, default mode.',
    }),
  );
  assert.equal(run.providerLabel, 'Example assistant');
  expectIssue(
    validateRunInput({
      name: 'Reversed',
      providerLabel: 'Example assistant',
      interfaceLabel: 'Consumer web interface',
      groundingMode: 'UNKNOWN',
      locale: 'en',
      captureFrom: '2026-10-28T12:00:00Z',
      captureTo: '2026-10-28T10:00:00Z',
      conditions: 'Manual capture.',
    }),
    'captureTo',
  );
});

test('completed observations require an answer, while failures require a reason', () => {
  const completed = expectOk(
    validateObservationDraftInput({
      queryId: 'q1',
      status: 'COMPLETED',
      capturedAt: '2026-10-28T12:00:00Z',
      answerText: 'Project A was created by Ram.',
      citationCapture: 'CAPTURED',
    }),
  );
  assert.equal(completed.answerText, 'Project A was created by Ram.');

  expectIssue(
    validateObservationDraftInput({
      queryId: 'q1',
      status: 'COMPLETED',
      capturedAt: '2026-10-28T12:00:00Z',
      citationCapture: 'CAPTURED',
    }),
    'answerText',
  );

  expectOk(
    validateObservationDraftInput({
      queryId: 'q1',
      status: 'ERROR',
      capturedAt: '2026-10-28T12:00:00Z',
      errorNote: 'The interface returned a server error.',
      citationCapture: 'UNKNOWN',
    }),
  );
  expectIssue(
    validateObservationDraftInput({
      queryId: 'q1',
      status: 'TIMEOUT',
      capturedAt: '2026-10-28T12:00:00Z',
      citationCapture: 'UNKNOWN',
    }),
    'errorNote',
  );

  expectOk(
    validateObservationDraftInput({
      queryId: 'q1',
      status: 'REFUSAL',
      capturedAt: '2026-10-28T12:00:00Z',
      answerText: 'I cannot help with that.',
      citationCapture: 'NOT_SHOWN',
    }),
  );
});

test('citation validation rejects non-HTTP URLs', () => {
  const citation = expectOk(
    validateCitationDraftInput({
      url: 'https://example.com/source',
      title: 'Source',
      snippet: 'Relevant excerpt.',
      targetOwned: 'on',
    }),
  );
  assert.equal(citation.targetOwned, true);
  expectIssue(validateCitationDraftInput({ url: 'javascript:alert(1)' }), 'url');
});

test('observation assessments enforce dimension-specific labels', () => {
  const presence = expectOk(
    validateObservationAssessmentDraftInput({
      dimension: 'PRESENCE',
      label: 'MENTIONED',
      rationale: 'The answer names Project A.',
      reviewer: 'Ram',
    }),
  );
  assert.equal(presence.dimension, 'PRESENCE');

  const attribution = expectOk(
    validateObservationAssessmentDraftInput({
      dimension: 'ATTRIBUTION',
      label: 'CORRECT',
      rationale: 'Names Ram and the role.',
      reviewer: 'Ram',
      attributionRole: 'AUTHOR',
    }),
  );
  assert.equal(attribution.attributionRole, 'AUTHOR');

  expectIssue(
    validateObservationAssessmentDraftInput({
      dimension: 'PRESENCE',
      label: 'ACCURATE',
      rationale: 'Wrong dimension.',
      reviewer: 'Ram',
    }),
    'label',
  );
  expectIssue(
    validateObservationAssessmentDraftInput({ dimension: 'UNKNOWN', label: 'MENTIONED' }),
    'dimension',
  );
  expectIssue(
    validateObservationAssessmentDraftInput({
      dimension: 'ATTRIBUTION',
      label: 'CORRECT',
      rationale: 'Bad role.',
      reviewer: 'Ram',
      attributionRole: 'OWNER',
    }),
    'attributionRole',
  );
});

test('reason, report, reviewer, and deletion confirmation validators are bounded', () => {
  expectOk(validateReasonInput({ reason: 'Correcting a typo.', reviewer: 'Ram' }));
  expectOk(validateReportInput({ title: 'Baseline report' }));
  expectOk(validateReportInput({}));
  expectOk(validateReviewerName('Ram'));
  expectIssue(validateReasonInput({ reason: '', reviewer: 'Ram' }), 'reason');
  expectIssue(validateConfirmationName('Other project', 'Aporia'), 'confirmation');
  expectOk(validateConfirmationName('Aporia', 'Aporia'));
});

test('empty input never throws and reports required fields', () => {
  const validators = [
    validateProjectInput,
    validateEntityInput,
    validateClaimRevisionInput,
    validatePropositionInput,
    validateSourceInput,
    validateEvidenceWithRelationInput,
    validateRelationshipChangeInput,
    validatePropositionAssessmentInput,
    validateQuerySetInput,
    validateQueryDraftInput,
    validateQuerySetApprovalInput,
    validateRunInput,
    validateObservationDraftInput,
    validateCitationDraftInput,
    validateObservationAssessmentDraftInput,
    validateReasonInput,
    validateReviewerName,
  ];
  for (const validator of validators) {
    const result = validator({});
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.issues.length > 0);
  }
});

test('project profile updates validate the same safe fields without a target entity', () => {
  const update = expectOk(
    validateProjectUpdateInput({
      name: 'Updated project',
      description: 'Updated description.',
      primaryDomain: 'https://example.com/updated',
    }),
  );
  assert.equal(update.name, 'Updated project');
  assert.equal(update.primaryDomain, 'https://example.com/updated');
  expectIssue(
    validateProjectUpdateInput({ name: 'Updated', primaryDomain: 'javascript:alert(1)' }),
    'primaryDomain',
  );
  expectIssue(validateProjectUpdateInput({ name: '' }), 'name');
});
