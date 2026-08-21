export interface Validation {
  discriminator: "validation";
  propertyName?: string;
  entityName?: string;
  childEntityIndex?: number;
  childEntityName?: string;
  detail: string;
  childPropertyName?: string;
}

export interface Problem {
  detail: string;
}

export interface StorageItemResponse {
  id: number | string;
  name?: string;
}

export type StorageResponse = StorageItemResponse[];

export interface Operation {
  key: number | string;
  operation: "insert" | "update" | "delete";
}

export type Entity = {
  entity_name: string;
  properties: {
    [name: string]: any;
  };
  children?: {
    [name: string]: {
      entity_name: string;
      properties: {
        [name: string]: any;
      };
    }[];
  };
};

export type UserPassword = {
  user: string;
  password: string;
  otp?: string;
};

export type OidcTokens = {
  accessToken: string;
  refreshToken?: string;
};

export type AuthCredential =
  | UserPassword
  | OidcTokens
  | { accessToken: string; refreshToken?: string; otp?: string };

export type OpenIdProvider = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  device_authorization_endpoint?: string;
  [key: string]: any;
};

export type Session = {
  clientAdress?: string;
  clientAddress?: string;
  name?: string;
  isSecure?: boolean;
  version?: string;
  oidcIssuer?: string;
  userName?: string;
  userKey?: number;
  roles?: string[];
  [key: string]: any;
};

export function isValidation(object: any): object is Validation {
  return (
    typeof object === "object" &&
    object !== null &&
    "discriminator" in object &&
    object.discriminator === "validation"
  );
}

export function isProblem(object: any): object is Problem {
  return (
    typeof object === "object" &&
    object !== null &&
    "detail" in object &&
    !("discriminator" in object)
  );
}

export function isOperation(object: any): object is Operation {
  return (
    typeof object === "object" &&
    object !== null &&
    "key" in object &&
    "operation" in object
  );
}

export function isStorage(object: unknown): object is StorageResponse {
  return (
    Array.isArray(object) &&
    object.length > 0 &&
    typeof object[0] === "object" &&
    object[0] !== null &&
    "id" in object[0]
  );
}

export function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type");
  return contentType !== null && (contentType.includes("application/json") || contentType.includes("application/problem+json"));
}
