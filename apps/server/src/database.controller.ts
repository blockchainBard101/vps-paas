import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { DatabaseService, S3BackupConfig } from './database.service.js';

@Controller('api/databases')
export class DatabaseController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  listDatabases() {
    return this.databaseService.listDatabases();
  }

  @Post('provision')
  provisionDatabase(@Body() body: { name?: string; dbName?: string }) {
    return this.databaseService.provisionPostgres(body.name, body.dbName);
  }

  @Post('provision-redis')
  provisionRedis(@Body() body: { name?: string }) {
    return this.databaseService.provisionRedis(body.name);
  }

  @Get(':id/introspect')
  introspectDatabase(@Param('id') id: string) {
    return this.databaseService.introspectSchema(id);
  }

  @Get(':id/data')
  getTableData(
    @Param('id') id: string,
    @Query('table') table: string,
    @Query('schema') schema = 'public',
    @Query('page') page = '0',
    @Query('pageSize') pageSize = '50',
  ) {
    return this.databaseService.getTableData(
      id,
      schema,
      table,
      parseInt(page, 10),
      parseInt(pageSize, 10),
    );
  }

  @Patch(':id/cell')
  updateCell(
    @Param('id') id: string,
    @Body()
    body: {
      schema: string;
      table: string;
      pkColumn: string;
      pkValue: any;
      column: string;
      newValue: any;
    },
  ) {
    return this.databaseService.updateCell(
      id,
      body.schema,
      body.table,
      body.pkColumn,
      body.pkValue,
      body.column,
      body.newValue,
    );
  }

  @Post(':id/query')
  executeQuery(
    @Param('id') id: string,
    @Body() body: { sql: string; readOnly?: boolean },
  ) {
    return this.databaseService.executeSql(id, body.sql, body.readOnly);
  }

  @Post(':id/row')
  insertRow(
    @Param('id') id: string,
    @Body() body: { schema?: string; table: string; rowData: Record<string, any> },
  ) {
    return this.databaseService.insertRow(
      id,
      body.schema || 'public',
      body.table,
      body.rowData,
    );
  }

  @Get(':id/backup/config')
  getBackupConfig(@Param('id') id: string) {
    return this.databaseService.getBackupConfig(id);
  }

  @Put(':id/backup/config')
  updateBackupConfig(
    @Param('id') id: string,
    @Body() body: Partial<S3BackupConfig>,
  ) {
    return this.databaseService.updateBackupConfig(id, body);
  }

  @Get(':id/backups')
  listBackups(@Param('id') id: string) {
    return this.databaseService.listBackups(id);
  }

  @Post(':id/backup')
  createBackup(@Param('id') id: string) {
    return this.databaseService.createBackup(id);
  }

  @Post(':id/restore/:backupId')
  restoreBackup(
    @Param('id') id: string,
    @Param('backupId') backupId: string,
  ) {
    return this.databaseService.restoreBackup(id, backupId);
  }

  @Delete(':id')
  deleteDatabase(@Param('id') id: string) {
    return this.databaseService.deleteDatabase(id);
  }
}
