import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { ContractDocumentStorageService } from './contract-document-storage.service.js';

@Module({ controllers: [CustomersController], providers: [CustomersService, ContractDocumentStorageService] })
export class CustomersModule {}
