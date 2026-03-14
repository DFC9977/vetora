{
    "name": "Vetora Clinic",
    "summary": "Core veterinary clinic models for Vetora, built on Odoo Community.",
    "version": "19.0.1.0.0",
    "author": "Vetora",
    "website": "https://vetora.local",
    "category": "Vertical Industry",
    "license": "LGPL-3",
    "depends": [
        "base",
        "contacts",
        "product",
    ],
    "data": [
        "security/ir.model.access.csv",
        "data/vetora_clinic_data.xml",
        "views/vet_menus.xml",
        "views/vet_pet_views.xml",
        "views/vet_visit_views.xml",
        "views/vet_vaccination_views.xml",
        "views/vet_service_views.xml",
        "views/vet_doctor_views.xml",
        "views/vet_schedule_views.xml",
        "views/vet_block_views.xml",
    ],
    "application": True,
    "installable": True,
}

