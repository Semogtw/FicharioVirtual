import { describe, expect, it } from 'vitest';
import {
	createTag,
	deleteTag,
	listTagDocumentIds,
	listTags,
	renameTag,
	setTagMembership,
	TagServiceError,
	type TagsClientLike
} from '../../../src/lib/services/tags';

const tagId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';

function client() {
	const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
	const value: TagsClientLike = {
		async rpc(name, args) {
			calls.push({ name, args });
			if (name === 'list_tags') {
				return {
					data: [
						{
							tag_id: tagId,
							name: 'Citologia',
							document_count: 3,
							created_at: '2026-08-02T08:00:00.000Z',
							updated_at: '2026-08-02T08:00:00.000Z'
						}
					],
					error: null
				};
			}
			if (name === 'create_tag') {
				return { data: tagId, error: null };
			}
			if (name === 'list_tag_document_ids') {
				return { data: [{ document_id: documentId }], error: null };
			}
			return { data: true, error: null };
		}
	};
	return { value, calls };
}

describe('tag service', () => {
	it('maps content-free tag summaries', async () => {
		const fixture = client();
		await expect(listTags(fixture.value)).resolves.toEqual([
			{
				id: tagId,
				name: 'Citologia',
				documentCount: 3,
				createdAt: '2026-08-02T08:00:00.000Z',
				updatedAt: '2026-08-02T08:00:00.000Z'
			}
		]);
	});

	it('normalizes tag names before creation', async () => {
		const fixture = client();
		await expect(createTag('  Citologia  ', fixture.value)).resolves.toBe(tagId);
		expect(fixture.calls.at(-1)).toEqual({
			name: 'create_tag',
			args: { tag_name: 'Citologia' }
		});
	});

	it('validates identifiers before changing membership', async () => {
		const fixture = client();
		await expect(setTagMembership(tagId, documentId, true, fixture.value)).resolves.toBeUndefined();
		expect(fixture.calls.at(-1)).toEqual({
			name: 'set_tag_membership',
			args: { target_tag_id: tagId, target_document_id: documentId, assigned: true }
		});
		await expect(setTagMembership('bad', documentId, true, fixture.value)).rejects.toThrow(
			'Invalid tag identifier'
		);
	});

	it('validates all local inputs before constructing the default Supabase client', async () => {
		await expect(createTag('   ')).rejects.toThrow('Invalid tag name');
		await expect(renameTag('bad', 'Citologia')).rejects.toThrow('Invalid tag identifier');
		await expect(renameTag(tagId, '\u0000')).rejects.toThrow('Invalid tag name');
		await expect(deleteTag('bad')).rejects.toThrow('Invalid tag identifier');
		await expect(listTagDocumentIds('bad')).rejects.toThrow('Invalid tag identifier');
		await expect(setTagMembership('bad', documentId, true)).rejects.toThrow(
			'Invalid tag identifier'
		);
		await expect(setTagMembership(tagId, 'bad', true)).rejects.toThrow(
			'Invalid document identifier'
		);
		await expect(setTagMembership(tagId, documentId, 'yes' as never)).rejects.toThrow(
			'Invalid tag assignment'
		);
	});

	it('rejects malformed tag and membership rows instead of dropping them', async () => {
		const malformedTags: TagsClientLike = {
			async rpc() {
				return {
					data: [
						{
							name: 'Citologia',
							document_count: 3,
							created_at: '2026-08-02T08:00:00.000Z',
							updated_at: '2026-08-02T08:00:00.000Z'
						}
					],
					error: null
				};
			}
		};
		await expect(listTags(malformedTags)).rejects.toBeInstanceOf(TagServiceError);

		const impossibleTimestamp: TagsClientLike = {
			async rpc() {
				return {
					data: [
						{
							tag_id: tagId,
							name: 'Citologia',
							document_count: 3,
							created_at: '2026-02-30T00:00:00.000Z',
							updated_at: '2026-08-02T08:00:00.000Z'
						}
					],
					error: null
				};
			}
		};
		await expect(listTags(impossibleTimestamp)).rejects.toBeInstanceOf(TagServiceError);

		const malformedMemberships: TagsClientLike = {
			async rpc() {
				return { data: [{ document_id: 'bad-id' }], error: null };
			}
		};
		await expect(listTagDocumentIds(tagId, malformedMemberships)).rejects.toBeInstanceOf(
			TagServiceError
		);
	});

	it('normalizes transport failures for every RPC entry point', async () => {
		const transport: TagsClientLike = {
			async rpc() {
				throw new Error('internal tags database host');
			}
		};

		await expect(listTags(transport)).rejects.toBeInstanceOf(TagServiceError);
		await expect(createTag('Citologia', transport)).rejects.toBeInstanceOf(TagServiceError);
		await expect(renameTag(tagId, 'Células', transport)).rejects.toBeInstanceOf(TagServiceError);
		await expect(deleteTag(tagId, transport)).rejects.toBeInstanceOf(TagServiceError);
		await expect(listTagDocumentIds(tagId, transport)).rejects.toBeInstanceOf(TagServiceError);
		await expect(setTagMembership(tagId, documentId, true, transport)).rejects.toBeInstanceOf(
			TagServiceError
		);
	});
});
