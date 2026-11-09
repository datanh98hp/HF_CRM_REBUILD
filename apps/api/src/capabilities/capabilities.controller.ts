import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth-metadata.js';

export type DeferredCapability = {
  status: 'DEFERRED';
  ready: false;
  messageVi: string;
};

export type CrmCapabilities = {
  customerMobileAuthentication: DeferredCapability;
  smsOtpGateway: DeferredCapability;
  contractCompletionOtp: DeferredCapability;
};

@Public()
@ApiTags('capabilities')
@Controller('capabilities')
export class CapabilitiesController {
  @Get()
  @ApiOperation({ summary: 'Feature readiness for the frontend' })
  getCapabilities(): CrmCapabilities {
    return {
      customerMobileAuthentication: {
        status: 'DEFERRED',
        ready: false,
        messageVi: 'Đăng nhập khách hàng trên ứng dụng di động sẽ được cấu hình ở giai đoạn sau.',
      },
      smsOtpGateway: {
        status: 'DEFERRED',
        ready: false,
        messageVi: 'Dịch vụ SMS chưa được cấu hình.',
      },
      contractCompletionOtp: {
        status: 'DEFERRED',
        ready: false,
        messageVi: 'Xác nhận hoàn thành hợp đồng bằng OTP hiện đang chờ cấu hình đăng nhập khách hàng và dịch vụ SMS.',
      },
    };
  }
}
