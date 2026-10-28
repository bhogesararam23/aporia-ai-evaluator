import {
  ASSESSMENT_DIMENSIONS,
  ASSESSMENT_LABELS_BY_DIMENSION,
  ATTRIBUTION_ROLES,
  CITATION_CAPTURE_STATES,
  ENTITY_TYPES,
  EVIDENCE_EXTRACTION_METHODS,
  EVIDENCE_RELATIONS,
  GROUNDING_MODES,
  IDENTITY_STATUSES,
  OBSERVATION_STATUSES,
  PROPOSITION_STATUSES,
  QUERY_INTENTS,
  SOURCE_ACCESS_ROUTES,
  SOURCE_INDEPENDENCE,
  SOURCE_TYPES,
  isAssessmentLabelForDimension,
  type AssessmentDimension,
  type AttributionRole,
  type CitationCaptureState,
  type EntityType,
  type EvidenceExtractionMethod,
  type EvidenceRelation,
  type GroundingMode,
  type IdentityStatus,
  type ObservationStatus,
  type PropositionStatus,
  type QueryIntent,
  type SourceAccessRoute,
  type SourceIndependence,
  type SourceType,
} from './vocabulary.ts';
import {
  enumValue,
  httpUrl,
  invalid,
  invalidMany,
  isoDateTime,
  localeTag,
  optionalDateOnly,
  optionalHttpUrl,
  optionalText,
  requiredText,
  valid,
  type ValidationIssue,
  type ValidationResult,
} from './validation.ts';

export type RawFields = Readonly<Record<string, unknown>>;

interface Reader {
  readonly issues: ValidationIssue[];
  read<T>(result: ValidationResult<T>): T;
  issue(field: string, message: string): void;
}

function createReader(): Reader {
  const issues: ValidationIssue[] = [];
  return {
    issues,
    read<T>(result: ValidationResult<T>): T {
      if (result.ok) {
        return result.value;
      }
      issues.push(...result.issues);
      return undefined as T;
    },
    issue(field: string, message: string): void {
      issues.push({ field, message });
    },
  };
}

function optionalEnumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): ValidationResult<T | undefined> {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return valid(undefined);
  }
  return enumValue(value, field, allowed);
}

function parseList(
  raw: unknown,
  field: string,
  maxItems: number,
  maxItemLength: number,
): ValidationResult<string[]> {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return valid([]);
  }
  if (typeof raw !== 'string') {
    return invalid(field, 'Enter a list of values.');
  }
  const values = raw
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const unique = [...new Set(values)];
  if (unique.length > maxItems) {
    return invalid(field, `Use ${maxItems} items or fewer.`);
  }
  const tooLong = unique.find((value) => value.length > maxItemLength);
  if (tooLong !== undefined) {
    return invalid(field, `Each item must be ${maxItemLength} characters or fewer.`);
  }
  return valid(unique);
}

function reviewer(raw: unknown, field = 'reviewer'): ValidationResult<string> {
  return requiredText(raw, field, { max: 80 });
}

export interface ProjectInput {
  readonly name: string;
  readonly description: string | undefined;
  readonly primaryDomain: string | undefined;
  readonly targetEntity: { readonly name: string; readonly type: EntityType } | null;
}

export function validateProjectInput(raw: RawFields): ValidationResult<ProjectInput> {
  const reader = createReader();
  const name = reader.read(requiredText(raw['name'], 'name', { max: 200 }));
  const description = reader.read(
    optionalText(raw['description'], 'description', { max: 4000, multiline: true }),
  );
  const primaryDomain = reader.read(optionalHttpUrl(raw['primaryDomain'], 'primaryDomain'));
  const entityName = reader.read(
    optionalText(raw['targetEntityName'], 'targetEntityName', { max: 200 }),
  );
  const entityType = reader.read(
    optionalEnumValue(raw['targetEntityType'], 'targetEntityType', ENTITY_TYPES),
  );
  if ((entityName === undefined) !== (entityType === undefined)) {
    reader.issue(
      'targetEntityName',
      'Provide both a target entity name and type, or leave both blank.',
    );
  }
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({
    name,
    description,
    primaryDomain,
    targetEntity:
      entityName !== undefined && entityType !== undefined
        ? { name: entityName, type: entityType }
        : null,
  });
}

export interface EntityInput {
  readonly type: EntityType;
  readonly canonicalName: string;
  readonly alternateNames: readonly string[];
  readonly publicUrls: readonly string[];
  readonly identityStatus: IdentityStatus;
  readonly identityMethod: string | undefined;
  readonly identityScope: string | undefined;
  readonly notes: string | undefined;
}

export function validateEntityInput(raw: RawFields): ValidationResult<EntityInput> {
  const reader = createReader();
  const type = reader.read(enumValue(raw['type'], 'type', ENTITY_TYPES));
  const canonicalName = reader.read(
    requiredText(raw['canonicalName'], 'canonicalName', { max: 200 }),
  );
  const alternateNames = reader.read(parseList(raw['alternateNames'], 'alternateNames', 20, 200));
  const urlValues = reader.read(parseList(raw['publicUrls'], 'publicUrls', 10, 2048));
  const publicUrls: string[] = [];
  for (const value of urlValues ?? []) {
    const url = httpUrl(value, 'publicUrls');
    if (!url.ok) {
      reader.issues.push(...url.issues);
    } else {
      publicUrls.push(url.value);
    }
  }
  const identityStatus = reader.read(
    enumValue(raw['identityStatus'], 'identityStatus', IDENTITY_STATUSES),
  );
  const identityMethod = reader.read(
    optionalText(raw['identityMethod'], 'identityMethod', { max: 500 }),
  );
  const identityScope = reader.read(
    optionalText(raw['identityScope'], 'identityScope', { max: 500 }),
  );
  const notes = reader.read(optionalText(raw['notes'], 'notes', { max: 4000, multiline: true }));
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({
    type,
    canonicalName,
    alternateNames,
    publicUrls,
    identityStatus,
    identityMethod,
    identityScope,
    notes,
  });
}

export interface ClaimRevisionInput {
  readonly text: string;
  readonly sourceUrl: string | undefined;
  readonly intendedMeaning: string | undefined;
  readonly timeScope: string | undefined;
  readonly locale: string;
}

export function validateClaimRevisionInput(raw: RawFields): ValidationResult<ClaimRevisionInput> {
  const reader = createReader();
  const text = reader.read(requiredText(raw['text'], 'text', { max: 5000, multiline: true }));
  const sourceUrl = reader.read(optionalHttpUrl(raw['sourceUrl'], 'sourceUrl'));
  const intendedMeaning = reader.read(
    optionalText(raw['intendedMeaning'], 'intendedMeaning', { max: 2000, multiline: true }),
  );
  const timeScope = reader.read(optionalText(raw['timeScope'], 'timeScope', { max: 500 }));
  const locale = reader.read(localeTag(raw['locale'], 'locale'));
  if (typeof text === 'string' && text.length < 10) {
    reader.issue('text', 'Enter at least 10 characters for a reviewable claim.');
  }
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({ text, sourceUrl, intendedMeaning, timeScope, locale });
}

export interface PropositionInput {
  readonly text: string;
  readonly subject: string | undefined;
  readonly predicate: string | undefined;
  readonly objectValue: string | undefined;
  readonly conditions: string | undefined;
  readonly timeInterval: string | undefined;
  readonly units: string | undefined;
  readonly evidenceRequirements: string;
  readonly expectedAnswerCriterion: string | undefined;
  readonly ambiguityNotes: string | undefined;
}

export function validatePropositionInput(raw: RawFields): ValidationResult<PropositionInput> {
  const reader = createReader();
  const text = reader.read(requiredText(raw['text'], 'text', { max: 2000, multiline: true }));
  const subject = reader.read(optionalText(raw['subject'], 'subject', { max: 500 }));
  const predicate = reader.read(optionalText(raw['predicate'], 'predicate', { max: 500 }));
  const objectValue = reader.read(optionalText(raw['objectValue'], 'objectValue', { max: 500 }));
  const conditions = reader.read(
    optionalText(raw['conditions'], 'conditions', { max: 1000, multiline: true }),
  );
  const timeInterval = reader.read(optionalText(raw['timeInterval'], 'timeInterval', { max: 500 }));
  const units = reader.read(optionalText(raw['units'], 'units', { max: 500 }));
  const evidenceRequirements = reader.read(
    requiredText(raw['evidenceRequirements'], 'evidenceRequirements', {
      max: 2000,
      multiline: true,
    }),
  );
  const expectedAnswerCriterion = reader.read(
    optionalText(raw['expectedAnswerCriterion'], 'expectedAnswerCriterion', {
      max: 2000,
      multiline: true,
    }),
  );
  const ambiguityNotes = reader.read(
    optionalText(raw['ambiguityNotes'], 'ambiguityNotes', { max: 2000, multiline: true }),
  );
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({
    text,
    subject,
    predicate,
    objectValue,
    conditions,
    timeInterval,
    units,
    evidenceRequirements,
    expectedAnswerCriterion,
    ambiguityNotes,
  });
}

export interface SourceInput {
  readonly title: string;
  readonly canonicalUri: string | undefined;
  readonly publisher: string | undefined;
  readonly author: string | undefined;
  readonly sourceType: SourceType;
  readonly accessRoute: SourceAccessRoute;
  readonly retrievedAt: string;
  readonly publicationDate: string | undefined;
  readonly language: string;
  readonly independence: SourceIndependence;
  readonly notes: string | undefined;
}

export function validateSourceInput(raw: RawFields): ValidationResult<SourceInput> {
  const reader = createReader();
  const title = reader.read(requiredText(raw['title'], 'title', { max: 300 }));
  const canonicalUri = reader.read(optionalHttpUrl(raw['canonicalUri'], 'canonicalUri'));
  const publisher = reader.read(optionalText(raw['publisher'], 'publisher', { max: 200 }));
  const author = reader.read(optionalText(raw['author'], 'author', { max: 200 }));
  const sourceType = reader.read(enumValue(raw['sourceType'], 'sourceType', SOURCE_TYPES));
  const accessRoute = reader.read(
    enumValue(raw['accessRoute'], 'accessRoute', SOURCE_ACCESS_ROUTES),
  );
  const retrievedAt = reader.read(isoDateTime(raw['retrievedAt'], 'retrievedAt'));
  const publicationDate = reader.read(optionalDateOnly(raw['publicationDate'], 'publicationDate'));
  const language = reader.read(localeTag(raw['language'], 'language'));
  const independence = reader.read(
    enumValue(raw['independence'], 'independence', SOURCE_INDEPENDENCE),
  );
  const notes = reader.read(optionalText(raw['notes'], 'notes', { max: 4000, multiline: true }));
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({
    title,
    canonicalUri,
    publisher,
    author,
    sourceType,
    accessRoute,
    retrievedAt,
    publicationDate,
    language,
    independence,
    notes,
  });
}

export interface EvidenceWithRelationInput {
  readonly locator: string;
  readonly excerpt: string;
  readonly extractionMethod: EvidenceExtractionMethod;
  readonly extractedAt: string;
  readonly relation: EvidenceRelation;
  readonly rationale: string;
  readonly reviewer: string;
}

export function validateEvidenceWithRelationInput(
  raw: RawFields,
): ValidationResult<EvidenceWithRelationInput> {
  const reader = createReader();
  const locator = reader.read(requiredText(raw['locator'], 'locator', { max: 500 }));
  const excerpt = reader.read(
    requiredText(raw['excerpt'], 'excerpt', { max: 20000, multiline: true }),
  );
  const extractionMethod = reader.read(
    enumValue(raw['extractionMethod'], 'extractionMethod', EVIDENCE_EXTRACTION_METHODS),
  );
  const extractedAt = reader.read(isoDateTime(raw['extractedAt'], 'extractedAt'));
  const relation = reader.read(enumValue(raw['relation'], 'relation', EVIDENCE_RELATIONS));
  const rationale = reader.read(
    requiredText(raw['rationale'], 'rationale', { max: 4000, multiline: true }),
  );
  const reviewerName = reader.read(reviewer(raw['reviewer']));
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({
    locator,
    excerpt,
    extractionMethod,
    extractedAt,
    relation,
    rationale,
    reviewer: reviewerName,
  });
}

export interface RelationshipChangeInput {
  readonly relation: EvidenceRelation;
  readonly rationale: string;
  readonly reviewer: string;
}

export function validateRelationshipChangeInput(
  raw: RawFields,
): ValidationResult<RelationshipChangeInput> {
  const reader = createReader();
  const relation = reader.read(enumValue(raw['relation'], 'relation', EVIDENCE_RELATIONS));
  const rationale = reader.read(
    requiredText(raw['rationale'], 'rationale', { max: 4000, multiline: true }),
  );
  const reviewerName = reader.read(reviewer(raw['reviewer']));
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({ relation, rationale, reviewer: reviewerName });
}

export interface PropositionAssessmentInput {
  readonly label: PropositionStatus;
  readonly rationale: string;
  readonly reviewer: string;
}

export function validatePropositionAssessmentInput(
  raw: RawFields,
): ValidationResult<PropositionAssessmentInput> {
  const reader = createReader();
  const label = reader.read(enumValue(raw['label'], 'label', PROPOSITION_STATUSES));
  const rationale = reader.read(
    requiredText(raw['rationale'], 'rationale', { max: 4000, multiline: true }),
  );
  const reviewerName = reader.read(reviewer(raw['reviewer']));
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({ label, rationale, reviewer: reviewerName });
}

export interface QuerySetInput {
  readonly name: string;
  readonly description: string | undefined;
  readonly locale: string;
}

export function validateQuerySetInput(raw: RawFields): ValidationResult<QuerySetInput> {
  const reader = createReader();
  const name = reader.read(requiredText(raw['name'], 'name', { max: 200 }));
  const description = reader.read(
    optionalText(raw['description'], 'description', { max: 4000, multiline: true }),
  );
  const locale = reader.read(localeTag(raw['locale'], 'locale'));
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({ name, description, locale });
}

export interface QueryDraftInput {
  readonly text: string;
  readonly intent: QueryIntent;
  readonly locale: string | undefined;
  readonly region: string | undefined;
  readonly branded: boolean;
  readonly expectedElements: string;
  readonly inclusionRationale: string;
}

export function validateQueryDraftInput(raw: RawFields): ValidationResult<QueryDraftInput> {
  const reader = createReader();
  const text = reader.read(requiredText(raw['text'], 'text', { max: 1000, multiline: true }));
  const intent = reader.read(enumValue(raw['intent'], 'intent', QUERY_INTENTS));
  const locale = reader.read(optionalLocale(raw['locale'], 'locale'));
  const region = reader.read(optionalText(raw['region'], 'region', { max: 100 }));
  const branded = raw['branded'] === 'on' || raw['branded'] === 'true' || raw['branded'] === '1';
  const expectedElements = reader.read(
    requiredText(raw['expectedElements'], 'expectedElements', { max: 2000, multiline: true }),
  );
  const inclusionRationale = reader.read(
    requiredText(raw['inclusionRationale'], 'inclusionRationale', {
      max: 1000,
      multiline: true,
    }),
  );
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({ text, intent, locale, region, branded, expectedElements, inclusionRationale });
}

function optionalLocale(value: unknown, field: string): ValidationResult<string | undefined> {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return valid(undefined);
  }
  return localeTag(value, field);
}

export interface QuerySetApprovalInput {
  readonly reviewer: string;
  readonly note: string | undefined;
}

export function validateQuerySetApprovalInput(
  raw: RawFields,
): ValidationResult<QuerySetApprovalInput> {
  const reader = createReader();
  const reviewerName = reader.read(reviewer(raw['reviewer']));
  const note = reader.read(optionalText(raw['note'], 'note', { max: 1000, multiline: true }));
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({ reviewer: reviewerName, note });
}

export interface RunInput {
  readonly name: string;
  readonly providerLabel: string;
  readonly modelLabel: string | undefined;
  readonly interfaceLabel: string;
  readonly groundingMode: GroundingMode;
  readonly locale: string;
  readonly region: string | undefined;
  readonly captureFrom: string;
  readonly captureTo: string;
  readonly conditions: string;
  readonly notes: string | undefined;
}

export function validateRunInput(raw: RawFields): ValidationResult<RunInput> {
  const reader = createReader();
  const name = reader.read(requiredText(raw['name'], 'name', { max: 200 }));
  const providerLabel = reader.read(
    requiredText(raw['providerLabel'], 'providerLabel', { max: 200 }),
  );
  const modelLabel = reader.read(optionalText(raw['modelLabel'], 'modelLabel', { max: 200 }));
  const interfaceLabel = reader.read(
    requiredText(raw['interfaceLabel'], 'interfaceLabel', { max: 200 }),
  );
  const groundingMode = reader.read(
    enumValue(raw['groundingMode'], 'groundingMode', GROUNDING_MODES),
  );
  const locale = reader.read(localeTag(raw['locale'], 'locale'));
  const region = reader.read(optionalText(raw['region'], 'region', { max: 100 }));
  const captureFrom = reader.read(isoDateTime(raw['captureFrom'], 'captureFrom'));
  const captureTo = reader.read(isoDateTime(raw['captureTo'], 'captureTo'));
  const conditions = reader.read(
    requiredText(raw['conditions'], 'conditions', { max: 2000, multiline: true }),
  );
  const notes = reader.read(optionalText(raw['notes'], 'notes', { max: 4000, multiline: true }));
  if (Date.parse(captureFrom) > Date.parse(captureTo)) {
    reader.issue('captureTo', 'The capture window end must be at or after the start.');
  }
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({
    name,
    providerLabel,
    modelLabel,
    interfaceLabel,
    groundingMode,
    locale,
    region,
    captureFrom,
    captureTo,
    conditions,
    notes,
  });
}

export interface ObservationDraftInput {
  readonly queryId: string;
  readonly status: ObservationStatus;
  readonly capturedAt: string;
  readonly answerText: string | undefined;
  readonly errorNote: string | undefined;
  readonly citationCapture: CitationCaptureState;
  readonly contextNotes: string | undefined;
}

export function validateObservationDraftInput(
  raw: RawFields,
): ValidationResult<ObservationDraftInput> {
  const reader = createReader();
  const queryId = reader.read(requiredText(raw['queryId'], 'queryId', { max: 100 }));
  const status = reader.read(enumValue(raw['status'], 'status', OBSERVATION_STATUSES));
  const capturedAt = reader.read(isoDateTime(raw['capturedAt'], 'capturedAt'));
  const citationCapture = reader.read(
    enumValue(raw['citationCapture'], 'citationCapture', CITATION_CAPTURE_STATES),
  );
  const contextNotes = reader.read(
    optionalText(raw['contextNotes'], 'contextNotes', { max: 4000, multiline: true }),
  );

  const answerRequiresText =
    status === 'COMPLETED' || status === 'REFUSAL' || status === 'NO_ANSWER';
  let answerText: string | undefined;
  let errorNote: string | undefined;
  if (answerRequiresText) {
    answerText = reader.read(
      requiredText(raw['answerText'], 'answerText', {
        max: 50000,
        multiline: true,
        trim: false,
      }),
    );
    errorNote = reader.read(
      optionalText(raw['errorNote'], 'errorNote', { max: 2000, multiline: true }),
    );
  } else {
    answerText = reader.read(
      optionalText(raw['answerText'], 'answerText', {
        max: 50000,
        multiline: true,
        trim: false,
      }),
    );
    errorNote = reader.read(
      requiredText(raw['errorNote'], 'errorNote', { max: 2000, multiline: true }),
    );
  }

  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({
    queryId,
    status,
    capturedAt,
    answerText,
    errorNote,
    citationCapture,
    contextNotes,
  });
}

export interface CitationDraftInput {
  readonly url: string;
  readonly title: string | undefined;
  readonly snippet: string | undefined;
  readonly targetOwned: boolean;
}

export function validateCitationDraftInput(raw: RawFields): ValidationResult<CitationDraftInput> {
  const reader = createReader();
  const url = reader.read(httpUrl(raw['url'], 'url'));
  const title = reader.read(optionalText(raw['title'], 'title', { max: 500 }));
  const snippet = reader.read(
    optionalText(raw['snippet'], 'snippet', { max: 2000, multiline: true }),
  );
  const targetOwned =
    raw['targetOwned'] === 'on' || raw['targetOwned'] === 'true' || raw['targetOwned'] === '1';
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({ url, title, snippet, targetOwned });
}

export interface ObservationAssessmentDraftInput {
  readonly dimension: AssessmentDimension;
  readonly label: string;
  readonly rationale: string;
  readonly reviewer: string;
  readonly attributionRole: AttributionRole | undefined;
}

export function validateObservationAssessmentDraftInput(
  raw: RawFields,
): ValidationResult<ObservationAssessmentDraftInput> {
  const reader = createReader();
  const dimensionResult = enumValue(raw['dimension'], 'dimension', ASSESSMENT_DIMENSIONS);
  if (!dimensionResult.ok) {
    reader.issues.push(...dimensionResult.issues);
  }
  const dimension = dimensionResult.ok ? dimensionResult.value : undefined;
  const labelRaw = raw['label'];
  if (dimension !== undefined) {
    if (typeof labelRaw !== 'string' || !isAssessmentLabelForDimension(dimension, labelRaw)) {
      reader.issue(
        'label',
        `Choose a valid ${dimension.toLowerCase().replace('_', ' ')} label: ${ASSESSMENT_LABELS_BY_DIMENSION[dimension].join(', ')}.`,
      );
    }
  } else if (typeof labelRaw !== 'string' || labelRaw.trim().length === 0) {
    reader.issue('label', 'Choose an assessment label.');
  }
  const rationale = reader.read(
    requiredText(raw['rationale'], 'rationale', { max: 4000, multiline: true }),
  );
  const reviewerName = reader.read(reviewer(raw['reviewer']));
  const attributionRole = reader.read(
    optionalEnumValue(raw['attributionRole'], 'attributionRole', ATTRIBUTION_ROLES),
  );
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({
    dimension: dimension as AssessmentDimension,
    label: labelRaw as string,
    rationale,
    reviewer: reviewerName,
    attributionRole,
  });
}

export interface ReasonInput {
  readonly reason: string;
  readonly reviewer: string;
}

export function validateReasonInput(raw: RawFields): ValidationResult<ReasonInput> {
  const reader = createReader();
  const reason = reader.read(requiredText(raw['reason'], 'reason', { max: 1000, multiline: true }));
  const reviewerName = reader.read(reviewer(raw['reviewer']));
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({ reason, reviewer: reviewerName });
}

export interface ReportInput {
  readonly title: string | undefined;
}

export function validateReportInput(raw: RawFields): ValidationResult<ReportInput> {
  const reader = createReader();
  const title = reader.read(optionalText(raw['title'], 'title', { max: 200 }));
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({ title });
}

export function validateReviewerName(value: unknown): ValidationResult<string> {
  return reviewer(value);
}

export function validateConfirmationName(
  value: unknown,
  expected: string,
): ValidationResult<string> {
  const confirmation = requiredText(value, 'confirmation', { max: 200 });
  if (!confirmation.ok) {
    return confirmation;
  }
  if (confirmation.value !== expected) {
    return invalid('confirmation', 'Type the project name exactly to confirm deletion.');
  }
  return confirmation;
}

export interface ProjectUpdateInput {
  readonly name: string;
  readonly description: string | undefined;
  readonly primaryDomain: string | undefined;
}

export function validateProjectUpdateInput(raw: RawFields): ValidationResult<ProjectUpdateInput> {
  const reader = createReader();
  const name = reader.read(requiredText(raw['name'], 'name', { max: 200 }));
  const description = reader.read(
    optionalText(raw['description'], 'description', { max: 4000, multiline: true }),
  );
  const primaryDomain = reader.read(optionalHttpUrl(raw['primaryDomain'], 'primaryDomain'));
  if (reader.issues.length > 0) {
    return invalidMany(reader.issues);
  }
  return valid({ name, description, primaryDomain });
}
