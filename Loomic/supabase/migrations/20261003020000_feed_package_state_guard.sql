alter table content_packages
  add constraint content_packages_status_check
  check (status in ('draft','structured','approved','rendering','failed','ready','scheduled','exported','published','measured','analyzed'))
  not valid;
