export interface EthosSession {
  EventType: number;
  SiteId: number;
  ActivityCode: string;
  LocationCode: string;
  LocationDescription: string;
  PeriodNumber: number | null;
  GroupCode: string;
  CourseCode: string;
  TicketId: number;
  TicketPrices: unknown;
  TicketActivityId: string | null;
  TicketActive: boolean;
  CourseType: string;
  Sequence: number;
  DisplayName: string;
  ActivityGroupId: string;
  ActivityGroupDescription: string;
  TermsAndConditionsUrl: string | null;
  ActivityDescription: string;
  StartTime: string;
  EndTime: string;
  TotalPlaces: number;
  AvailablePlaces: number;
  AvailablePlaceLocationDescription: string;
  AvailablePlacesLocationDescription: string;
  UseNotifyMeLists: boolean;
  UseBookingSequence: boolean;
  BookableType: number;
  ApplicableFilters: Array<{
    Id: string;
    DisplayName: string;
    Order: number;
    TagGroupId: string;
    TagGroupName: string;
    Enabled: boolean;
  }>;
  ImageUrl: string | null;
  PriceStruct: string;
  PriceBand: number;
  Price: number;
  SubLocationGroups: unknown;
  DurationDescription: string;
  StartSales: string;
  EndSales: string;
  EnableSales: boolean;
  UntilEndWarningEnabled: boolean;
  UntilEndWarningText: string | null;
  Instructor: string | null;
  IsPartyTicket: boolean;
  PartyPurchaseImmediate: boolean;
  PartyPurchaseBeforeStart: number;
  PartyPurchaseUntilStart: number;
  PartyPurchaseUntilStartSel: boolean;
  PurchaseAdditionalSpaces: boolean;
  PricePerAdditionalSpaceText: string | null;
  NoOfAdditonalSpaces: number;
  PricePerAdditionalSpace: number;
  ReleaseUnsoldSpaces: boolean;
  IgnoreMembershipBookAheadPeriod: boolean;
  PartyAvailablePlaces: number | null;
  PartyStartSales: string;
  PartyEndSales: string;
}

export interface EthosBooking {
  Activity: string;
  ActivityCode: string;
  EnrolmentNo: number;
  Reference: number;
  Sequence: number;
  GroupCode: string;
  Code: string;
  CourseOrClass: string;
  BookingDate: string;
  StartTime: string;
  Location: string;
  LocationCode: string;
  Site: string;
  SiteNo: number;
  Cost: number;
  Duration: number;
  CanCancel: boolean;
  CanRebook: boolean;
  CanTransfer: boolean;
  Type: number;
  SiteId: number;
  DurationDescription: string;
  SubLocation: string;
  SubLocationCode: string;
  DisplayName: string;
  BookedForMemberNo: number;
}

export interface BasketItem {
  Id: 0;
  BasketId: "00000000-0000-0000-0000-000000000000";
  Description: string;
  Type: "Xn.Enrolment";
  DisplayOrder: 1;
  SiteId: number;
  GrossAmount: 0;
  VATCode: "S";
  ItemOwnerPersonFK: number;
  BasketItemMetadata: {
    EnrolmentType: 2;
    GroupCode: string;
    Code: string;
    PriceStruct: string;
    PriceBand: number;
    CourseOrSes: "S";
    EnrolmentNumber: -1;
    SequenceNo: number;
    ActivityGroupId: string;
    LocationTypeSingular: "";
    ActivityCode: string;
    LocationCode: string;
    SendEmailReminder: "true";
    SendSMSReminder: "false";
    DurationDescription: string;
    LocationDescription: string;
    StartTime: string;
    EndTime: string;
    SiteName: "Ethos";
  };
}

export interface AuthResult {
  accessToken: string;
  personId: number;
  memberNo: number;
  cookies: string;
}

export interface BookingConfirmation {
  ConfirmationUrl: string;
}

// props stored in the OAuth token, available via getMcpAuthContext()
export interface EthosProps {
  email: string;
  password: string;
  personId: number;
  memberNo: number;
}

export interface Env {
  OAUTH_PROVIDER: {
    completeAuthorization(params: {
      request: unknown;
      userId: string;
      scope: string[];
      props: EthosProps;
    }): Promise<{ redirectTo: string }>;
  };
  OAUTH_KV: KVNamespace;
}
