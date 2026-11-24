const path = require('node:path');
const { DEFAULT_COMPANY, getCompany } = require('../../scripts/core/config');

const company = getCompany(process.env.SITE_EMPRESA || DEFAULT_COMPANY);
const dataRoot = company.id === DEFAULT_COMPANY
  ? null
  : path.join(path.dirname(path.resolve(process.env.SITE_ENV_FILE)), 'instances', company.id);

module.exports = {
  dataRoot,
  publicRoot: dataRoot ? path.join(dataRoot, 'public') : null,
};
