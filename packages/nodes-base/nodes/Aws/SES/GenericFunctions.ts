import { URL } from 'url';

import { Request, sign } from 'aws4';

import { OptionsWithUri } from 'request';

import { parseString } from 'xml2js';

import {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-core';

import { IDataObject, NodeApiError, NodeOperationError } from 'n8n-workflow';

import { get } from 'lodash';

export async function awsApiRequest(
	this: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions | IWebhookFunctions,
	service: string,
	method: string,
	path: string,
	body?: string,
	headers?: object,
	// tslint:disable-next-line:no-any
): Promise<any> {
	const credentials = await this.getCredentials('aws');

	const endpoint = new URL(
		(((credentials.sesEndpoint as string) || '').replace(
			'{region}',
			credentials.region as string,
		) || `https://${service}.${credentials.region}.amazonaws.com`) + path,
	);

	// Sign AWS API request with the user credentials

	const signOpts = { headers: headers || {}, host: endpoint.host, method, path, body } as Request;
	const securityHeaders = {
		accessKeyId: `${credentials.accessKeyId}`.trim(),
		secretAccessKey: `${credentials.secretAccessKey}`.trim(),
		sessionToken: credentials.temporaryCredentials
			? `${credentials.sessionToken}`.trim()
			: undefined,
	};

	sign(signOpts, securityHeaders);

	const options: OptionsWithUri = {
		headers: signOpts.headers,
		method,
		uri: endpoint.href,
		body: signOpts.body as string,
	};

	try {
		return await this.helpers.request!(options);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error, { parseXml: true });
	}
}

export async function awsApiRequestREST(
	this: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions,
	service: string,
	method: string,
	path: string,
	body?: string,
	headers?: object,
	// tslint:disable-next-line:no-any
): Promise<any> {
	const response = await awsApiRequest.call(this, service, method, path, body, headers);
	try {
		return JSON.parse(response);
	} catch (error) {
		return response;
	}
}

export async function awsApiRequestSOAP(
	this: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions | IWebhookFunctions,
	service: string,
	method: string,
	path: string,
	body?: string,
	headers?: object,
	// tslint:disable-next-line:no-any
): Promise<any> {
	const response = await awsApiRequest.call(this, service, method, path, body, headers);
	try {
		return await new Promise((resolve, reject) => {
			parseString(response, { explicitArray: false }, (err, data) => {
				if (err) {
					return reject(err);
				}
				resolve(data);
			});
		});
	} catch (error) {
		return response;
	}
}

export async function awsApiRequestSOAPAllItems(
	this: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions | IWebhookFunctions,
	propertyName: string,
	service: string,
	method: string,
	path: string,
	body?: string,
	query: IDataObject = {},
	headers: IDataObject = {},
	option: IDataObject = {},
	region?: string,
	// tslint:disable-next-line:no-any
): Promise<any> {
	const returnData: IDataObject[] = [];

	let responseData;

	const propertyNameArray = propertyName.split('.');

	do {
		responseData = await awsApiRequestSOAP.call(this, service, method, path, body, query);

		if (get(responseData, `${propertyNameArray[0]}.${propertyNameArray[1]}.NextToken`)) {
			query['NextToken'] = get(
				responseData,
				`${propertyNameArray[0]}.${propertyNameArray[1]}.NextToken`,
			);
		}
		if (get(responseData, propertyName)) {
			if (Array.isArray(get(responseData, propertyName))) {
				returnData.push.apply(returnData, get(responseData, propertyName));
			} else {
				returnData.push(get(responseData, propertyName));
			}
		}
	} while (
		get(responseData, `${propertyNameArray[0]}.${propertyNameArray[1]}.NextToken`) !== undefined
	);

	return returnData;
}
