-- Normalize accepted OCR history deterministically after the initial result-history
-- migration. A page may have more than one historical ready job/result; the
-- accepted pointer must never depend on UPDATE ... FROM row-order accidents.

update public.pages as page
   set accepted_ocr_result_id = (
     select result.id
       from public.ocr_results as result
      where result.page_id = page.id
        and result.user_id = page.user_id
      order by result.created_at desc, result.id desc
      limit 1
   )
 where exists (
   select 1
     from public.ocr_results as result
    where result.page_id = page.id
      and result.user_id = page.user_id
 );
