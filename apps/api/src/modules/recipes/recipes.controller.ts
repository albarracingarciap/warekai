import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  costingSchema,
  createRecipeSchema,
  draftCostingSchema,
  priceSuggestionQuerySchema,
  priceSuggestionSchema,
  recipeListEntrySchema,
  recipeQuerySchema,
  recipeSchema,
  scaleRecipeQuerySchema,
  updateRecipeSchema,
  type CostingDto,
  type CreateRecipeDto,
  type DraftCostingDto,
  type Paginated,
  type PriceSuggestionDto,
  type PriceSuggestionQuery,
  type RecipeDto,
  type RecipeListEntryDto,
  type RecipeQuery,
  type UpdateRecipeDto,
} from '@warekai/contracts';
import {
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
  registerSchema,
} from '../../common/openapi';
import { CurrentUser, type Principal } from '../../common/principal';
import { zodPipe } from '../../common/zod-validation.pipe';
import { CostingService } from '../costing/costing.service';
import { RecipesService } from './recipes.service';

const Recipe = registerSchema('Recipe', recipeSchema);
const RecipeListEntry = registerSchema('RecipeListEntry', recipeListEntrySchema);
const CreateRecipe = registerSchema('CreateRecipe', createRecipeSchema);
const UpdateRecipe = registerSchema('UpdateRecipe', updateRecipeSchema);
const Costing = registerSchema('Costing', costingSchema);
const DraftCosting = registerSchema('DraftCosting', draftCostingSchema);
const PriceSuggestion = registerSchema('PriceSuggestion', priceSuggestionSchema);

@ApiTags('Recetas y escandallos')
@Controller('recipes')
export class RecipesController {
  constructor(
    private readonly recipes: RecipesService,
    private readonly costing: CostingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listado de recetas vigentes' })
  @ApiZodArrayResponse(RecipeListEntry)
  list(
    @CurrentUser() principal: Principal,
    @Query(zodPipe(recipeQuerySchema)) query: RecipeQuery,
  ): Promise<Paginated<RecipeListEntryDto>> {
    return this.recipes.list(principal, query);
  }

  /**
   * Va antes que `:id` a proposito: en Nest gana la primera ruta que encaja, y
   * "draft" seria capturado por el parametro.
   */
  @Post('costing/draft')
  @ApiOperation({
    summary: 'Escandallo de unas lineas sin guardar',
    description:
      'Alimenta el coste en vivo del editor. La regla de calculo sigue viviendo en ' +
      'packages/domain en lugar de reimplementarse en el navegador.',
  })
  @ApiZodBody(DraftCosting)
  @ApiZodResponse(Costing)
  draftCosting(
    @CurrentUser() principal: Principal,
    @Body(zodPipe(draftCostingSchema)) dto: DraftCostingDto,
  ): Promise<CostingDto> {
    return this.costing.getForDraft(principal, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ficha de receta con sus lineas' })
  @ApiZodResponse(Recipe)
  findOne(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RecipeDto> {
    return this.recipes.findOne(principal, id);
  }

  @Post()
  @ApiOperation({ summary: 'Alta de receta' })
  @ApiZodBody(CreateRecipe)
  @ApiZodResponse(Recipe, 201)
  create(
    @CurrentUser() principal: Principal,
    @Body(zodPipe(createRecipeSchema)) dto: CreateRecipeDto,
  ): Promise<RecipeDto> {
    return this.recipes.create(principal, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modificar la receta vigente' })
  @ApiZodBody(UpdateRecipe)
  @ApiZodResponse(Recipe)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateRecipeSchema)) dto: UpdateRecipeDto,
  ): Promise<RecipeDto> {
    return this.recipes.update(principal, id, dto);
  }

  @Post(':id/versions')
  @ApiOperation({
    summary: 'Cerrar la version vigente y abrir una nueva',
    description:
      'Un escandallo firmado hace seis meses tiene que poder reconstruirse tal como era: ' +
      'sostiene una decision de precio que ya se tomo.',
  })
  @ApiZodResponse(Recipe, 201)
  publishVersion(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RecipeDto> {
    return this.recipes.publishNewVersion(principal, id);
  }

  @Get(':id/costing')
  @ApiOperation({ summary: 'Escandallo explotado de una receta guardada' })
  @ApiZodResponse(Costing)
  costingFor(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CostingDto> {
    return this.costing.getForRecipe(principal, id);
  }

  @Get(':id/price-suggestion')
  @ApiOperation({ summary: 'PVP necesario para alcanzar un food cost objetivo' })
  @ApiZodResponse(PriceSuggestion)
  priceSuggestion(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(priceSuggestionQuerySchema)) query: PriceSuggestionQuery,
  ): Promise<PriceSuggestionDto> {
    return this.costing.getPriceSuggestion(principal, id, query);
  }

  @Get(':id/scaled')
  @ApiOperation({ summary: 'Receta escalada a N raciones, para produccion' })
  scaled(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(scaleRecipeQuerySchema)) query: { portions: number },
  ) {
    return this.costing.scale(principal, id, query.portions);
  }
}
