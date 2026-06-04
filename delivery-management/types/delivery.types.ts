/**
 * Delivery Management Type Definitions
 * Comprehensive types for delivery workflow, tracking, and management
 */

// Delivery Status Enum
export enum DeliveryStatus {
  PENDING_ASSIGNMENT = 'Pending Assignment',
  DRIVER_ASSIGNED = 'Driver Assigned',
  ACCEPTED_BY_DRIVER = 'Accepted by Driver',
  PICKED_UP = 'Picked Up',
  OUT_FOR_DELIVERY = 'Out for Delivery',
  DELIVERED = 'Delivered',
  DELIVERY_FAILED = 'Delivery Failed',
  CUSTOMER_NOT_AVAILABLE = 'Customer Not Available',
  WRONG_ADDRESS = 'Wrong Address',
  RETURNED = 'Returned',
  CANCELLED = 'Cancelled',
  RESCHEDULED = 'Rescheduled',
}

// Delivery Priority Enum
export enum DeliveryPriority {
  NORMAL = 'Normal',
  HIGH = 'High',
  URGENT = 'Urgent',
  EMERGENCY = 'Emergency',
}

// Driver Status Enum
export enum DriverStatus {
  AVAILABLE = 'Available',
  BUSY = 'Busy',
  ON_DELIVERY = 'On Delivery',
  OFFLINE = 'Offline',
  ON_LEAVE = 'On Leave',
}

// Failure Reason Enum
export enum FailureReason {
  CUSTOMER_NOT_AVAILABLE = 'Customer Not Available',
  WRONG_ADDRESS = 'Wrong Address',
  NO_RESPONSE = 'No Response',
  REFUSED_DELIVERY = 'Refused Delivery',
  VEHICLE_BREAKDOWN = 'Vehicle Breakdown',
  WEATHER_CONDITIONS = 'Weather Conditions',
  OTHER = 'Other',
}

// Return Status Enum
export enum ReturnStatus {
  RETURN_REQUESTED = 'Return Requested',
  RETURN_APPROVED = 'Return Approved',
  RETURN_PICKED_UP = 'Return Picked Up',
  RETURNED_TO_WAREHOUSE = 'Returned to Warehouse',
  COMPLETED = 'Completed',
}

// Delivery Interface
export interface Delivery {
  id: string;
  trackingNumber: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  deliveryAddress: string;
  driverId: string | null;
  driverName: string | null;
  driverMobile: string | null;
  vehicleNumber: string | null;
  assignedAt: Date | null;
  acceptedAt: Date | null;
  pickedUpAt: Date | null;
  outForDeliveryAt: Date | null;
  deliveredAt: Date | null;
  deliveryStatus: DeliveryStatus;
  deliveryPriority: DeliveryPriority;
  estimatedDeliveryTime: Date;
  dispatchTime: Date | null;
  proofPhoto: string | null;
  proofSignature: string | null;
  receiverName: string | null;
  receiverOTP: string | null;
  deliveryNotes: string;
  gpsCoordinates: GPSCoordinates | null;
  failureReason: FailureReason | null;
  returnStatus: ReturnStatus | null;
  assignedBy: string | null;
  assignmentDate: Date | null;
  driverAcceptanceTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Driver Interface
export interface Driver {
  id: string;
  driverId: string;
  fullName: string;
  mobileNumber: string;
  email: string;
  emiratesId: string;
  licenseNumber: string;
  licenseExpiry: Date;
  vehicleType: string;
  vehicleRegistration: string;
  status: DriverStatus;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  deliveryRating: number;
  lastActiveTime: Date | null;
  currentLocation: GPSCoordinates | null;
  currentDeliveryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// GPS Coordinates Interface
export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: Date;
}

// Delivery Timeline Event Interface
export interface DeliveryTimelineEvent {
  id: string;
  deliveryId: string;
  status: DeliveryStatus;
  timestamp: Date;
  userId: string;
  userAction: string;
  description: string;
  metadata?: Record<string, any>;
}

// Proof of Delivery Interface
export interface ProofOfDelivery {
  id: string;
  deliveryId: string;
  signature: string;
  photo: string;
  otp: string;
  receiverName: string;
  deliveryTimestamp: Date;
  gpsCoordinates: GPSCoordinates;
  createdAt: Date;
}

// Delivery Assignment Interface
export interface DeliveryAssignment {
  id: string;
  deliveryId: string;
  driverId: string;
  assignedBy: string;
  assignmentDate: Date;
  driverAcceptanceTime: Date | null;
  assignmentMethod: 'Manual' | 'Automatic' | 'Nearest Driver';
  status: 'Pending' | 'Accepted' | 'Rejected';
  rejectionReason: string | null;
}

// Real-Time Tracking Interface
export interface RealtimeTracking {
  deliveryId: string;
  driverId: string;
  currentLocation: GPSCoordinates;
  routeMap: RoutePoint[];
  distanceRemaining: number;
  estimatedArrivalTime: Date;
  deliveryProgress: number;
  trafficInformation: TrafficInfo;
  lastUpdateTime: Date;
}

// Route Point Interface
export interface RoutePoint {
  latitude: number;
  longitude: number;
  timestamp: Date;
  speed: number;
}

// Traffic Information Interface
export interface TrafficInfo {
  condition: 'Clear' | 'Moderate' | 'Heavy' | 'Severe';
  delay: number;
  incidents: string[];
}

// Dashboard Summary Interface
export interface DashboardSummary {
  totalDeliveriesToday: number;
  pendingDispatch: number;
  assignedDeliveries: number;
  outForDelivery: number;
  deliveredToday: number;
  failedDeliveries: number;
  returnedDeliveries: number;
  activeDrivers: number;
  availableDrivers: number;
  driverUtilizationRate: number;
}

// Delivery Report Interface
export interface DeliveryReport {
  id: string;
  reportType:
    | 'Daily'
    | 'Monthly'
    | 'Driver Performance'
    | 'Failed Deliveries'
    | 'Return Deliveries'
    | 'Delivery Time Analysis'
    | 'Success Rate'
    | 'Revenue';
  startDate: Date;
  endDate: Date;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  returnedDeliveries: number;
  averageDeliveryTime: number;
  successRate: number;
  totalRevenue: number;
  generatedAt: Date;
  generatedBy: string;
  data: Record<string, any>;
}

// Audit Log Interface
export interface AuditLog {
  id: string;
  deliveryId: string | null;
  action: string;
  user: string;
  date: Date;
  time: Date;
  ipAddress: string;
  details: Record<string, any>;
  metadata?: Record<string, any>;
}

// Notification Interface
export interface Notification {
  id: string;
  deliveryId: string;
  customerId: string;
  type: 'SMS' | 'WhatsApp' | 'Email' | 'Push Notification';
  event:
    | 'Order Assigned'
    | 'Driver Assigned'
    | 'Out for Delivery'
    | 'Driver Nearby'
    | 'Delivered'
    | 'Delivery Failed'
    | 'Rescheduled';
  message: string;
  status: 'Pending' | 'Sent' | 'Failed' | 'Delivered';
  sentAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
}

// Delivery Filter Options Interface
export interface DeliveryFilterOptions {
  status?: DeliveryStatus;
  priority?: DeliveryPriority;
  driverId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  searchTerm?: string;
}

// Pagination Interface
export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// API Response Interface
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
