import { COMMA, ENTER, SPACE } from '@angular/cdk/keycodes';
import { Location } from '@angular/common';
import { Component, Injector, Type } from '@angular/core';
import { AbstractControl, FormControl, FormGroup } from '@angular/forms';
import { MatChipInputEvent } from '@angular/material/chips';
import { ActivatedRoute } from '@angular/router';
import { take } from 'rxjs';
import {
  AddAzureADProviderRequest as AdminAddAzureADProviderRequest,
  GetProviderByIDRequest as AdminGetProviderByIDRequest,
  UpdateAzureADProviderRequest as AdminUpdateAzureADProviderRequest,
} from 'src/app/proto/generated/zitadel/admin_pb';
import { AzureADTenant, AzureADTenantType, Options, Provider } from 'src/app/proto/generated/zitadel/idp_pb';
import {
  AddAzureADProviderRequest as MgmtAddAzureADProviderRequest,
  GetProviderByIDRequest as MgmtGetProviderByIDRequest,
  UpdateAzureADProviderRequest as MgmtUpdateAzureADProviderRequest,
} from 'src/app/proto/generated/zitadel/management_pb';
import { AdminService } from 'src/app/services/admin.service';
import { Breadcrumb, BreadcrumbService, BreadcrumbType } from 'src/app/services/breadcrumb.service';
import { GrpcAuthService } from 'src/app/services/grpc-auth.service';
import { ManagementService } from 'src/app/services/mgmt.service';
import { ToastService } from 'src/app/services/toast.service';
import { requiredValidator } from '../../form-field/validators/validators';

import { PolicyComponentServiceType } from '../../policies/policy-component-types.enum';

@Component({
  selector: 'cnsl-provider-azure-ad',
  templateUrl: './provider-azure-ad.component.html',
})
export class ProviderAzureADComponent {
  public showOptional: boolean = false;
  public options: Options = new Options().setIsCreationAllowed(true).setIsLinkingAllowed(true);
  public id: string | null = '';
  public serviceType: PolicyComponentServiceType = PolicyComponentServiceType.MGMT;
  private service!: ManagementService | AdminService;

  public readonly separatorKeysCodes: number[] = [ENTER, COMMA, SPACE];

  public form!: FormGroup;

  public loading: boolean = false;

  public provider?: Provider.AsObject;
  public updateClientSecret: boolean = false;

  public AzureTenantIDType: number = 3;
  public tenantTypes = [
    this.AzureTenantIDType,
    AzureADTenantType.AZURE_AD_TENANT_TYPE_COMMON,
    AzureADTenantType.AZURE_AD_TENANT_TYPE_ORGANISATIONS,
    AzureADTenantType.AZURE_AD_TENANT_TYPE_CONSUMERS,
  ];

  constructor(
    private authService: GrpcAuthService,
    private route: ActivatedRoute,
    private toast: ToastService,
    private injector: Injector,
    private _location: Location,
    private breadcrumbService: BreadcrumbService,
  ) {
    this.form = new FormGroup({
      name: new FormControl('', []),
      clientId: new FormControl('', [requiredValidator]),
      clientSecret: new FormControl('', [requiredValidator]),
      scopesList: new FormControl(['openid', 'profile', 'email'], []),
      tenantType: new FormControl<AzureADTenantType>(AzureADTenantType.AZURE_AD_TENANT_TYPE_COMMON),
      tenantId: new FormControl<string>(''),
      emailVerified: new FormControl(false),
    });

    this.authService
      .isAllowed(
        this.serviceType === PolicyComponentServiceType.ADMIN
          ? ['iam.idp.write']
          : this.serviceType === PolicyComponentServiceType.MGMT
          ? ['org.idp.write']
          : [],
      )
      .pipe(take(1))
      .subscribe((allowed) => {
        if (allowed) {
          this.form.enable();
        } else {
          this.form.disable();
        }
      });

    this.route.data.pipe(take(1)).subscribe((data) => {
      this.serviceType = data['serviceType'];

      switch (this.serviceType) {
        case PolicyComponentServiceType.MGMT:
          this.service = this.injector.get(ManagementService as Type<ManagementService>);

          const bread: Breadcrumb = {
            type: BreadcrumbType.ORG,
            routerLink: ['/org'],
          };

          this.breadcrumbService.setBreadcrumb([bread]);
          break;
        case PolicyComponentServiceType.ADMIN:
          this.service = this.injector.get(AdminService as Type<AdminService>);

          const iamBread = new Breadcrumb({
            type: BreadcrumbType.ORG,
            name: 'Instance',
            routerLink: ['/instance'],
          });
          this.breadcrumbService.setBreadcrumb([iamBread]);
          break;
      }

      this.id = this.route.snapshot.paramMap.get('id');
      if (this.id) {
        this.clientSecret?.setValidators([]);
        this.getData(this.id);
      }
    });
  }

  private getData(id: string): void {
    const req =
      this.serviceType === PolicyComponentServiceType.ADMIN
        ? new AdminGetProviderByIDRequest()
        : new MgmtGetProviderByIDRequest();
    req.setId(id);
    this.service
      .getProviderID(req)
      .then((resp) => {
        const object = resp.toObject();
        this.provider = object.idp;
        this.loading = false;
        if (this.provider?.config?.azureAd) {
          this.form.patchValue(this.provider.config.azureAd);
          this.name?.setValue(this.provider.name);
          this.tenantId?.setValue(this.provider.config.azureAd.tenant?.tenantId);
          this.tenantType?.setValue(this.provider.config.azureAd.tenant?.tenantType);

          const tenant = resp.getIdp()?.getConfig()?.getAzureAd()?.getTenant();

          if (tenant) {
            switch (tenant.getTypeCase()) {
              case AzureADTenant.TypeCase.TENANT_ID:
                this.tenantId?.setValue(tenant.getTenantId());
                this.tenantType?.setValue(this.AzureTenantIDType);
                break;
              case AzureADTenant.TypeCase.TENANT_TYPE:
                this.tenantType?.setValue(tenant.getTenantType());
                this.tenantId?.setValue('');
                break;
              case AzureADTenant.TypeCase.TYPE_NOT_SET:
                this.tenantType?.setValue(this.AzureTenantIDType);
                break;
            }
          }
        }
      })
      .catch((error) => {
        this.toast.showError(error);
        this.loading = false;
      });
  }

  public submitForm(): void {
    this.provider ? this.updateAzureADProvider() : this.addAzureADProvider();
  }

  public addAzureADProvider(): void {
    const req =
      this.serviceType === PolicyComponentServiceType.MGMT
        ? new MgmtAddAzureADProviderRequest()
        : new AdminAddAzureADProviderRequest();

    req.setName(this.name?.value);
    req.setClientId(this.clientId?.value);
    req.setClientSecret(this.clientSecret?.value);
    req.setEmailVerified(this.emailVerified?.value);

    const tenant = new AzureADTenant();
    if (this.tenantType?.value === this.AzureTenantIDType) {
      tenant.setTenantId(this.tenantId?.value);
    } else {
      tenant.setTenantType(this.tenantType?.value);
    }
    req.setTenant(tenant);

    req.setScopesList(this.scopesList?.value);
    req.setProviderOptions(this.options);

    this.loading = true;
    this.service
      .addAzureADProvider(req)
      .then((idp) => {
        setTimeout(() => {
          this.loading = false;
          this.close();
        }, 2000);
      })
      .catch((error) => {
        this.toast.showError(error);
        this.loading = false;
      });
  }

  public updateAzureADProvider(): void {
    if (this.provider) {
      const req =
        this.serviceType === PolicyComponentServiceType.MGMT
          ? new MgmtUpdateAzureADProviderRequest()
          : new AdminUpdateAzureADProviderRequest();

      req.setId(this.provider.id);
      req.setName(this.name?.value);
      req.setClientId(this.clientId?.value);
      req.setEmailVerified(this.emailVerified?.value);

      const tenant = new AzureADTenant();
      if (this.tenantType?.value === this.AzureTenantIDType) {
        tenant.setTenantId(this.tenantId?.value);
      } else {
        tenant.setTenantType(this.tenantType?.value);
      }
      req.setTenant(tenant);

      req.setScopesList(this.scopesList?.value);
      req.setProviderOptions(this.options);

      if (this.updateClientSecret) {
        req.setClientSecret(this.clientSecret?.value);
      }

      this.loading = true;
      this.service
        .updateAzureADProvider(req)
        .then((idp) => {
          setTimeout(() => {
            this.loading = false;
            this.close();
          }, 2000);
        })
        .catch((error) => {
          this.toast.showError(error);
          this.loading = false;
        });
    }
  }

  public close(): void {
    this._location.back();
  }

  public addScope(event: MatChipInputEvent): void {
    const input = event.chipInput?.inputElement;
    const value = event.value.trim();

    if (value !== '') {
      if (this.scopesList?.value) {
        this.scopesList.value.push(value);
        if (input) {
          input.value = '';
        }
      }
    }
  }

  public removeScope(uri: string): void {
    if (this.scopesList?.value) {
      const index = this.scopesList.value.indexOf(uri);

      if (index !== undefined && index >= 0) {
        this.scopesList.value.splice(index, 1);
      }
    }
  }

  public get name(): AbstractControl | null {
    return this.form.get('name');
  }

  public get clientId(): AbstractControl | null {
    return this.form.get('clientId');
  }

  public get clientSecret(): AbstractControl | null {
    return this.form.get('clientSecret');
  }

  public get scopesList(): AbstractControl | null {
    return this.form.get('scopesList');
  }

  public get emailVerified(): AbstractControl | null {
    return this.form.get('emailVerified');
  }

  public get tenantId(): AbstractControl | null {
    return this.form.get('tenantId');
  }

  public get tenantType(): AbstractControl | null {
    return this.form.get('tenantType');
  }
}
