'use strict';

// PHI keywords — should eventually come from DB config table
const PHI_KEYWORDS = new Set([
  'patient','clinical','medical','health','ehr','emr','epic','cerner',
  'meditech','allscripts','fhir','hl7','dicom','radiology','pharmacy',
  'diagnosis','treatment','prescription','lab','imaging','genomic',
  'insurance','billing','claims','medicare','medicaid','hipaa',
  'mrn','ssn','dob','dateofbirth','admissions','discharge',
]);

const PHI_RESOURCE_TYPES = new Set([
  'microsoft.healthcareapis','microsoft.health',
  'epic','cerner','meditech','clinical','patient',
]);

const PHI_PROTOCOLS = new Set(['FHIR','HL7','DICOM','CCD','HL7v2']);

/**
 * Detect if a resource likely processes PHI
 * @param {Object} resource - Azure resource object
 * @returns {boolean}
 */
function detectPHI(resource) {
  const searchStr = [
    resource.name || '',
    resource.type || '',
    resource.notes || '',
    JSON.stringify(resource.tags || {}),
  ].join(' ').toLowerCase();

  if ([...PHI_KEYWORDS].some(k => searchStr.includes(k))) return true;
  if ([...PHI_RESOURCE_TYPES].some(t => (resource.type||'').toLowerCase().includes(t))) return true;
  if ((resource.protocols||[]).some(p => PHI_PROTOCOLS.has(p))) return true;
  return false;
}

/**
 * Calculate HIPAA compliance status based on PHI exposure
 */
function hipaaStatus(agent) {
  if (!agent.phi) return 'pass';
  // PHI agent with no audit trail = fail
  if (!agent.auditEnabled) return 'fail';
  // PHI agent with audit but no encryption = warn
  if (!agent.encrypted) return 'warn';
  return 'warn';
}

module.exports = { detectPHI, hipaaStatus, PHI_KEYWORDS, PHI_PROTOCOLS };
