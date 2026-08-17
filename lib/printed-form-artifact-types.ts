export type PrintedFormArtifactSnapshot={id:number;organizationId:number;documentId:number;formType:string;templateVersion:number;documentState:string;payloadJson:string;storageKey:string;sha256:string};
export type PrintedFormPdfArtifact={key:string;bytes:Uint8Array;binarySha256:string;etag:string;created:boolean};
export type PrintedFormArtifactErrorCode="runtime_unavailable"|"render_failed"|"invalid_pdf"|"integrity_failed"|"invalid_snapshot";
export class PrintedFormArtifactError extends Error{
 code:PrintedFormArtifactErrorCode;
 constructor(code:PrintedFormArtifactErrorCode,message:string){super(message);this.code=code;this.name="PrintedFormArtifactError";}
}
