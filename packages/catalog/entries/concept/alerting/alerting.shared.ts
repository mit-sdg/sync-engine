export class AlertCauseConflict extends Error {}
export class AlertNotOpenForRecipient extends Error {}

export interface AlertRecord {
  alert: string;
  recipient: string;
  subject: string;
  cause: string;
  raisedAt: Date;
  open: boolean;
}

export interface OpenAlertRecord {
  alert: string;
  subject: string;
  cause: string;
  raisedAt: Date;
}

export interface AlertDetails {
  recipient: string;
  subject: string;
  cause: string;
  raisedAt: Date;
  open: boolean;
}
