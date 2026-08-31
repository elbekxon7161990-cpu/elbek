/** Plain interface — apps/api's own class-validator DTO maps onto this shape after ValidationPipe runs. */
export interface AdminLoginPasswordStepInput {
  email: string;
  password: string;
}
