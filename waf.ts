// Commands/workflow taken from the Fastly WAF documentation, https://docs.fastly.com/en/ngwaf/edge-deployment
// "wait 1-2 minutes to allow the edge resources to be created" - even other request often fail when done in parallel
import { RequestInfo, RequestInit } from "node-fetch";

const retryFetch = (url: RequestInfo, init?: RequestInit) => import("node-fetch").then(({ default: fetch }) => fetch(url, init));
import * as crypto from 'node:crypto';
import * as pulumi from '@pulumi/pulumi';

export interface WafConfig {
  siteName: string;
  email: string;
  authToken: pulumi.Output<string>;
  fastlyApiKey: pulumi.Output<string>;
}

export interface WafArgs {
  origins: pulumi.Input<string[]>;
  siteName: string;
  serviceId: pulumi.Input<string>;
  email: string;
  authToken: pulumi.Input<string>;
  fastlyApiKey: pulumi.Input<string>;
}

export class Waf extends pulumi.dynamic.Resource {
  constructor(name: string, args: WafArgs, opts: pulumi.ComponentResourceOptions) {
    super(new WafProvider(), name, args, { ...opts, deleteBeforeReplace: true });
  }
}

interface ApiRequestArgs {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: object;
}

async function makeApiRequest(args: ApiRequestArgs) {
  const body = args.body ? JSON.stringify(args.body) : null;
  const response = await retryFetch(args.url, {
    method: args.method,
    headers: args.headers!,
    body: body!
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}\n${await response.text()}`);
  }

  return response.json();
}

interface WafProviderInputs {
  origins: string[];
  siteName: string;
  serviceId: string;
  email: string;
  authToken: string;
  fastlyApiKey: string;
}

interface WafProviderOutputs {
  apiUrl: string;
  headers: Record<string, string>;
  origins: string[];
  siteName: string;
  serviceId: string;
  email: string;
  authToken: string;
  fastlyApiKey: string;
}

export class WafProvider implements pulumi.dynamic.ResourceProvider {
  async create(inputs: WafProviderInputs): Promise<pulumi.dynamic.CreateResult> {
    const id = crypto.randomUUID();
    const updateResults = await this.update(
      id,
      {
        apiUrl: '',
        headers: {},
        origins: [],
        siteName: '',
        serviceId: '',
        email: '',
        authToken: '',
        fastlyApiKey: '',
      },
      inputs,
    );

    return {
      id,
      outs: updateResults.outs,
    };
  }

  // biome-ignore lint/suspicious/useAwait: <explanation>
  async diff(_id: string, olds: WafProviderOutputs, news: WafProviderInputs): Promise<pulumi.dynamic.DiffResult> {
    if (
      olds.siteName !== news.siteName ||
      olds.serviceId !== news.serviceId ||
      olds.origins.toString() !== news.origins.toString() ||
      olds.email !== news.email ||
      olds.authToken !== news.authToken ||
      olds.fastlyApiKey !== news.fastlyApiKey
    ) {
      return { changes: true };
    }
    return { changes: false };
  }

  async update(_id: string, olds: WafProviderOutputs, inputs: WafProviderInputs): Promise<pulumi.dynamic.UpdateResult> {
    const apiUrl = `https://dashboard.signalsciences.net/api/v0/corps/kontent/sites/${inputs.siteName}/edgeDeployment/${inputs.serviceId}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-user': inputs.email,
      'x-api-token': inputs.authToken,
      'Fastly-Key': inputs.fastlyApiKey,
    };
    const syncUrl = `${apiUrl}/backends`;

    if (olds.apiUrl !== apiUrl) {
      // Mapping to the fastly service
      try {
        await makeApiRequest({
          url: apiUrl,
          method: 'PUT',
          headers: headers,
          body: {
            activateVersion: true,
            percentEnabled: 100,
          },
        });
      } catch (e) {
        console.error(`Mapping to the fastly service failed: \n${e}`);
        throw e;
      }
    }

    // Synchronizing origins
    try {
      await makeApiRequest({
        url: syncUrl,
        method: 'PUT',
        headers,
      });
    } catch (e) {
      console.error(`Synchronizing origins failed: \n${e}`);
      throw e;
    }

    return {
      outs: {
        apiUrl,
        headers,
        ...inputs,
      },
    };
  }

  async delete(_id: string, props: WafProviderOutputs) {
    if (props.apiUrl && props.headers) {
      try {
        await makeApiRequest({
          url: props.apiUrl,
          method: 'DELETE',
          headers: props.headers,
        });
      } catch (e) {
        console.warn(`Detaching edgeDeployment from fastly service failed\n${e}`);
      }
    }
  }

  async check(_olds: WafProviderOutputs, news: WafProviderInputs): Promise<pulumi.dynamic.CheckResult> {
    const failures: pulumi.dynamic.CheckFailure[] = [];
    if (!news.authToken) {
      failures.push({
        property: 'authToken',
        reason: 'authToken is required',
      });
    }
    if (!news.email) {
      failures.push({
        property: 'email',
        reason: 'email is required',
      });
    }
    if (!news.fastlyApiKey) {
      failures.push({
        property: 'fastlyApiKey',
        reason: 'fastlyApiKey is required',
      });
    }
    if (!news.origins) {
      failures.push({
        property: 'origins',
        reason: 'origins is required',
      });
    }
    if (!news.serviceId) {
      failures.push({
        property: 'serviceId',
        reason: 'serviceId is required',
      });
    }
    if (!news.siteName) {
      failures.push({
        property: 'siteName',
        reason: 'siteName is required',
      });
    }
    if (failures.length > 0) {
      return { failures: failures };
    }

    return { inputs: news };
  }
}
