import { describe, expect, it } from 'vitest';
import { hasVisualSearchIntent } from '../../../supabase/functions/_shared/visual-search-policy';

describe('visual search intent policy', () => {
	it.each([
		'quero encontrar a anotação manuscrita sobre artéria vertebral',
		'um gráfico de barras com três categorias',
		'qual imagem mostra o fluxograma de atendimento',
		'uma tabela com os resultados da experiência',
		'qual é a página escaneada com a assinatura'
	])('allows standalone visual retrieval for visual query: %s', (query) => {
		expect(hasVisualSearchIntent(query)).toBe(true);
	});

	it.each([
		'como preparar uma receita de bolo de chocolate com cobertura',
		'como trocar o óleo do motor de um carro',
		'qual vaso sobe pelo pescoço e irriga o cérebro',
		'por que esfregar um balão de látex faz ele grudar no teto',
		'como uma máquina com memória reconhece linguagens'
	])('does not allow image noise for ordinary text query: %s', (query) => {
		expect(hasVisualSearchIntent(query)).toBe(false);
	});

	it('normalizes accents without broadening ordinary questions', () => {
		expect(hasVisualSearchIntent('qual é a imagem da artéria?')).toBe(true);
		expect(hasVisualSearchIntent('qual é a artéria vertebral?')).toBe(false);
	});
});
