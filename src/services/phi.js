'use strict';

const HEALTHCARE_KEYWORDS = [
  'patient', 'clinical', 'ehr', 'fhir', 'mrn', 'diagnosis', 'hipaa', 'phi',
  'hl7', 'dicom', 'cerner', 'epic', 'health', 'medical', 'hospital', 'ccd',
  'prescription', 'pharmacy', 'radiology', 'lab', 'encounter', 'claims',
];

const PHI_RESOURCE_TYPES = [
  'Microsoft.HealthcareApis/services',
  'Microsoft.HealthcareApis/workspaces',
  'Microsoft.HealthcareApis/workspaces/fhirservices',
  'Microsoft.HealthcareApis/workspaces/dicomservices',
  'Microsoft.HealthcareApis/workspaces/iotconnectors',
];

const HEALTHCARE_PROTOCOLS = ['fhir', 'hl7', 'hl7v2', 'dicom', 'ccd'];

/**
 * Module 2 — PHI / Sensitive Data Detection (metadata-based, three vectors)
 */
function detectPhi(agent) {
  const vectors = [];
  const haystack = [
    agent.name,
    agent.resource_type,
    agent.resource_group,
    agent.azure_resource_id,
    JSON.stringify(agent.tags || {}),
    JSON.stringify(agent.metadata || {}),
    ...(agent.protocols || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const matchedKeywords = HEALTHCARE_KEYWORDS.filter((kw) => haystack.includes(kw));
  if (matchedKeywords.length) {
    vectors.push({ type: 'keyword', matches: matchedKeywords });
  }

  const rt = (agent.resource_type || '').toLowerCase();
  if (PHI_RESOURCE_TYPES.some((t) => t.toLowerCase() === rt || rt.includes('healthcareapis'))) {
    vectors.push({ type: 'resource_type', matches: [agent.resource_type] });
  }

  const protocols = (agent.protocols || []).map((p) => String(p).toLowerCase());
  const matchedProtocols = HEALTHCARE_PROTOCOLS.filter(
    (p) => protocols.includes(p) || haystack.includes(p)
  );
  if (matchedProtocols.length) {
    vectors.push({ type: 'protocol', matches: matchedProtocols });
  }

  const flagged = vectors.length > 0;
  return {
    phi_flagged: flagged,
    phi_vectors: vectors,
    // Conservative: flagged agents default to HIPAA fail until cleared
    hipaa_status: flagged ? 'fail' : 'na',
  };
}

module.exports = { detectPhi, HEALTHCARE_KEYWORDS, PHI_RESOURCE_TYPES, HEALTHCARE_PROTOCOLS };
