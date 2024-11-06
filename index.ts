import { ServiceVcl } from '@pulumi/fastly';
import type {
  ServiceVclBackend,
} from '@pulumi/fastly/types/input';
import * as pulumi from '@pulumi/pulumi';
import { Waf } from './waf';

const config = new pulumi.Config();
const backends: ServiceVclBackend[] = [
  {
    address: 'example.com',
    name: `Example`
  },
];

const serviceVcl = new ServiceVcl(
  'jiristest',
  {
    backends,
    defaultTtl: 3600,
    dictionaries: [
      {
        name: 'Edge_Security',
      },
    ],
    domains: [{ name: 'jiristest.global.ssl.fastly.net' }],
  },
  {
    ignoreChanges: ['versionComment', 'dynamicsnippets'],
  },
);

const waf = new Waf(
  `jiristest-waf`,
  {
    siteName: config.require('sigSciSite'),
    email: config.require('sigSciEmail'),
    authToken: config.requireSecret('sigSciApiKey'),
    fastlyApiKey: config.requireSecret('fastly:apiKey'),
    origins: pulumi.output(backends.map((b) => b.address)),
    serviceId: serviceVcl.id,
  },
  {
    parent: serviceVcl
  },
);
