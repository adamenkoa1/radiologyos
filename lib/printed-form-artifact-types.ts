export type PrintedFormArtifactSnapshot={id:number;organizationId:number;documentId:number;formType:string;templateVersion:number;documentState:string;payloadJson:string;storageKey:string;sha256:string};
export type PrintedFormPdfArtifact={key:string;bytes:Uint8Array;binarySha256:string;etag:string;created:boolean};
export class PrintedFormArtifactError extends Error{
 constructor(readonly code:"runtime_unavailable"|"render_failed"|"invalid_pdf"|"integrity_failed"|"invalid_snapshot",message:string){super(message);this.name="PrintedFormArtifactError";}
}
