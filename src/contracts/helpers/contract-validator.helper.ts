import { BadRequestException } from '@nestjs/common';
import { AffiliatePersonDto } from '../dto/affiliate-person.dto';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';

/**
 * Validates the structure and domain rules of affiliates before contract creation.
 */
export function validateContractAffiliates(affiliates: AffiliatePersonDto[]): void {
  // 1. Validate TITULAR count (optional, but at most one)
  const titulars = affiliates.filter((a) => a.role === PersonRole.TITULAR);
  if (titulars.length > 1) {
    throw new BadRequestException('Solo puede haber un TITULAR por contrato.');
  }

  // 2. Validate billing owner count (at most one)
  const billingOwners = affiliates.filter((a) => a.isBillingOwner === true);
  if (billingOwners.length > 1) {
    throw new BadRequestException('Solo puede haber un responsable de facturación por contrato.');
  }

  // 3. Validate AFILIADO planId
  for (const affiliate of affiliates) {
    if (affiliate.role === PersonRole.AFILIADO && !affiliate.planId) {
      throw new BadRequestException(
        `El afiliado ${affiliate.name} (${affiliate.typeIdentityCard}-${affiliate.identityCard}) debe tener un plan asignado.`,
      );
    }
  }

  // 4. Validate duplicate identity cards within the same contract request
  const seenDocuments = new Set<string>();
  for (const affiliate of affiliates) {
    const docKey = `${affiliate.typeIdentityCard}-${affiliate.identityCard}`;
    if (seenDocuments.has(docKey)) {
      throw new BadRequestException(
        `La persona con cédula ${docKey} está duplicada en la lista de afiliados.`,
      );
    }
    seenDocuments.add(docKey);
  }
}

/**
 * Checks if two ContractPerson instances refer to the same physical person based on identity document.
 */
export function isSamePerson(cp1?: ContractPerson | null, cp2?: ContractPerson | null): boolean {
  if (!cp1?.person || !cp2?.person) return false;
  return (
    cp1.person.typeIdentityCard === cp2.person.typeIdentityCard &&
    cp1.person.identityCard === cp2.person.identityCard
  );
}
