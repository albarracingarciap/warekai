import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  conversionPreviewSchema,
  createItemFamilySchema,
  createItemSchema,
  itemFamilySchema,
  itemListEntrySchema,
  itemQuerySchema,
  itemSchema,
  updateItemSchema,
  type ConversionPreviewDto,
  type CreateItemDto,
  type CreateItemFamilyDto,
  type ItemDto,
  type ItemFamilyDto,
  type ItemListEntryDto,
  type ItemQuery,
  type Paginated,
  type UpdateItemDto,
} from '@warekai/contracts';
import {
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
  registerSchema,
} from '../../common/openapi';
import { CurrentUser, type Principal } from '../../common/principal';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CatalogService } from './catalog.service';

const Item = registerSchema('Item', itemSchema);
const ItemListEntry = registerSchema('ItemListEntry', itemListEntrySchema);
const ItemFamily = registerSchema('ItemFamily', itemFamilySchema);
const CreateItem = registerSchema('CreateItem', createItemSchema);
const UpdateItem = registerSchema('UpdateItem', updateItemSchema);
const CreateItemFamily = registerSchema('CreateItemFamily', createItemFamilySchema);
const ConversionPreview = registerSchema('ConversionPreview', conversionPreviewSchema);

@ApiTags('Catalogo')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('items')
  @ApiOperation({ summary: 'Listado de items del catalogo' })
  @ApiZodArrayResponse(ItemListEntry)
  list(
    @CurrentUser() principal: Principal,
    @Query(zodPipe(itemQuerySchema)) query: ItemQuery,
  ): Promise<Paginated<ItemListEntryDto>> {
    return this.catalog.list(principal, query);
  }

  @Get('items/:id')
  @ApiOperation({ summary: 'Ficha de un item, con unidades y alergenos' })
  @ApiZodResponse(Item)
  findOne(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ItemDto> {
    return this.catalog.findOne(principal, id);
  }

  @Post('items')
  @ApiOperation({ summary: 'Alta de item' })
  @ApiZodBody(CreateItem)
  @ApiZodResponse(Item, 201)
  create(
    @CurrentUser() principal: Principal,
    @Body(zodPipe(createItemSchema)) dto: CreateItemDto,
  ): Promise<ItemDto> {
    return this.catalog.create(principal, dto);
  }

  @Patch('items/:id')
  @ApiOperation({
    summary: 'Modificar un item',
    description:
      'Si el cambio afecta al coste -- precio, unidades o merma de limpieza -- se encola el ' +
      'recalculo en cascada de todas las recetas que lo usan.',
  })
  @ApiZodBody(UpdateItem)
  @ApiZodResponse(Item)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateItemSchema)) dto: UpdateItemDto,
  ): Promise<ItemDto> {
    return this.catalog.update(principal, id, dto);
  }

  @Delete('items/:id')
  @ApiOperation({
    summary: 'Baja logica de un item',
    description:
      'No se borra: un item referenciado por un escandallo historico debe seguir existiendo.',
  })
  @ApiZodResponse(Item)
  deactivate(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ItemDto> {
    return this.catalog.deactivate(principal, id);
  }

  @Get('families')
  @ApiOperation({ summary: 'Familias del catalogo, con su jerarquia' })
  @ApiZodArrayResponse(ItemFamily)
  listFamilies(@CurrentUser() principal: Principal): Promise<ItemFamilyDto[]> {
    return this.catalog.listFamilies(principal);
  }

  @Post('families')
  @ApiOperation({ summary: 'Alta de familia' })
  @ApiZodBody(CreateItemFamily)
  @ApiZodResponse(ItemFamily, 201)
  createFamily(
    @CurrentUser() principal: Principal,
    @Body(zodPipe(createItemFamilySchema)) dto: CreateItemFamilyDto,
  ): Promise<ItemFamilyDto> {
    return this.catalog.createFamily(principal, dto);
  }

  @Post('convert')
  @ApiOperation({
    summary: 'Convertir una cantidad entre unidades de un item',
    description:
      'Usa los puentes del item (densidad y peso por pieza). La cuenta la hace el motor de ' +
      'costes, no el navegador.',
  })
  @ApiZodBody(ConversionPreview)
  convert(
    @CurrentUser() principal: Principal,
    @Body(zodPipe(conversionPreviewSchema)) dto: ConversionPreviewDto,
  ): Promise<{ amount: string; unit: string }> {
    return this.catalog.previewConversion(principal, dto);
  }
}
